# Jarvis

One chat, forever. The owner talks to a single captain; the captain keeps its
memory outside the LLM session, so the session can be thrown away and rebuilt
at any time without losing anything. See `BRIEF.md` for the full intent.

Status: **step 1 done** - memory, captain, session rotation, terminal chat.
Not yet: chat UI (step 2), spawning agents (step 3), nightly sleep (step 4),
long-run eval (step 5).

## Run it

Needs Node 22.18+ (runs the TypeScript directly), pnpm, and a logged-in
`claude` CLI.

```sh
pnpm install
pnpm chat                       # interactive chat
./src/cli.ts ask "what are we doing?"   # one turn
```

Chat commands: `/now`, `/tasks`, `/facts`, `/search <words>`,
`/get <F1|T1|L1>`, `/rotate`, `/sessions`, `/quit`. Each reply ends with its
ledger id and how full the captain's context is.

### Docker

```sh
cp .env.example .env            # set UID/GID to `id -u` / `id -g`
docker compose run --rm jarvis
docker compose run --rm jarvis ask "what are we doing?"
```

Memory lives in the `jarvis-data` volume. To keep it in a host folder,
`mkdir -p data` first (Docker would create it as root) and set
`JARVIS_DATA=./data`. Your Claude login is mounted from `~/.claude` and
`~/.claude.json`.

## Configuration

| Variable                  | Default            | Meaning |
|---------------------------|--------------------|---------|
| `JARVIS_DATA_DIR`         | `~/.jarvis`        | Holds `memory.db`; also the captain's working directory. |
| `JARVIS_MODEL`            | `opus`             | Captain model. |
| `JARVIS_ROTATE_AT`        | `0.4`              | Rotate when context passes this fraction of the window. |
| `JARVIS_MAX_TURNS`        | `40`               | Backstop: rotate after this many turns in one session. |
| `JARVIS_ALLOWED_TOOLS`    | `Read,Glob,Grep,Bash(git status:*),Bash(git log:*),Bash(git diff:*)` | Built-in tools for live checks. Memory tools are always on. |
| `JARVIS_RECALL_FACTS`     | `6`                | Facts recalled per message. |
| `JARVIS_RECALL_LEDGER`    | `4`                | Ledger hits recalled per message. |
| `JARVIS_TAIL_MESSAGES`    | `12`               | Recent conversation shown to a fresh session. |
| `JARVIS_TAIL_CHARS`       | `12000`            | Char budget for that tail. |
| `JARVIS_NOW_BUDGET_CHARS` | `8000`             | Hard cap on Now (~2k tokens). |
| `JARVIS_PROMPT_FILE`      | `prompts/captain.md` | Captain system prompt. |
| `JARVIS_TURN_TIMEOUT`     | `600`              | Seconds before a turn is abandoned. |
| `JARVIS_CLAUDE_BIN`       | `claude`           | Claude Code binary. |

## How it works

```
owner message
  -> ledger (L id)
  -> prompt = [Now + open tasks + recent tail]  (fresh session only)
            + recalled facts/ledger hits         (only ones not shown yet)
            + the message
  -> claude -p --resume <session>  (MCP: jarvis memory tools)
  -> reply -> ledger
  -> rotate?  context >= 40% | a task closed | max turns | /rotate
       -> handoff turn: captain writes Now, then the session is dropped
```

**Memory** (`src/memory/store.ts`): one SQLite file via `node:sqlite` (no
native deps), FTS5 with porter stemming.

- `ledger` - every message, decision, fact/task/Now change, rotation.
  Append-only, enforced by triggers. The chat history *is* the ledger.
- `facts` - atomic notes with kind, subject, source and dates. Writing one with
  `supersedes` marks the old ones stale; stale facts are hidden from recall.
- `tasks` - goal, plan, status, result. Every change is ledgered with from/to
  status, which is how "a task closed" triggers rotation.
- `now` - one versioned note with a hard char budget.
- `sessions` - each captain session, its turns, peak tokens, why it ended.

**Captain tools** (`src/mcp/server.ts`, stdio MCP): `memory_search`,
`memory_get`, `memory_write`, `fact_mark_stale`, `now_update`, `now_get`,
`task_create`, `task_update`, `task_list`, `task_get`, `log_decision`. Every
write is stamped with the captain session id.

**Truthfulness**: the prompt requires citing `[L..]`/`[F..]`/`[T..]` for any
claim about the past and saying "I don't have that" when search finds nothing.
The em dash ban is enforced in code (`src/text.ts`) on replies and all memory
writes, because models ignore it in prompts (haiku did in testing).

### Why headless per turn, not an interactive session in tmux

Measured, 2026-10-03, Claude Code 2.1.289:

- `claude -p --output-format json` returns per-call `usage.iterations` and the
  model's `contextWindow`, so "context at 40%" is an exact number, not a guess
  from the screen.
- `--resume <id>` keeps the session and the prompt cache (turn 2 read 30k
  tokens from cache), so per-turn calls are not paying to re-read context.
- Rotation is just "stop resuming": no process to kill, no trust prompts or
  menus to dodge (see the agent-hq lessons in `~/kb/AGENTS.md`).
- `--setting-sources "" --strict-mcp-config --system-prompt` shrinks the
  baseline from ~30k tokens (user CLAUDE.md, hooks, plugins) to ~400, so the
  captain's context holds only what Jarvis puts there. A primed captain turn
  with tools is ~9-10k tokens (5% of a 200k window).

Trade-off: no streaming of partial replies in the terminal yet; each turn
spawns the CLI (~2-5s overhead). Worth it for exact measurement and trivial
rotation. Workers in step 3 still run interactively in tmux via agent-hq.

### Retrieval quality (keyword only, no embeddings)

`test/retrieval.test.ts`, 30 facts + 300 noise ledger entries:

- direct questions (share a content word with the fact): **100% hit@1**, 22/22
- paraphrases (no shared words, e.g. "what graphics card do I have" for the
  GPU fact): **17% hit@6**

So keyword recall is enough when the owner reuses their own nouns, which is
the common case, and the captain is told to retry `memory_search` with
variants. Paraphrase recall is the known gap; the step 5 long-run eval decides
whether to add embeddings (sqlite-vec).

## Tests

```sh
pnpm test          # memory, retrieval quality, MCP over stdio, captain loop (fake runner)
pnpm test:live     # real claude (haiku): rotate, then a fresh session must answer
                   # "what are we doing and why" from memory alone (tail disabled),
                   # and must say "I don't have that" for an unknown fact
pnpm typecheck
```

## Schema changes

The schema is created only on a brand-new file. On a version mismatch Jarvis
refuses to start instead of migrating; migrations are prepared as SQL and run
by the owner by hand. Jarvis also refuses to open a SQLite file that is not
its own.

## Layout

```
src/cli.ts               terminal chat
src/config.ts            env config
src/memory/store.ts      SQLite memory: ledger, facts, tasks, now, sessions
src/mcp/server.ts        memory tools for the captain (MCP, stdio)
src/captain/captain.ts   turn loop, rotation
src/captain/prompt.ts    what the captain sees each turn
src/captain/runner.ts    one headless claude call
prompts/captain.md       captain system prompt
```
