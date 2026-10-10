# Wednesday

**Personal AI assistant | You tell me, I'll handle everything else without nagging**

One chat, forever. Wednesday keeps its memory in a SQLite file outside the model
session, so sessions rotate freely and nothing is forgotten. Real work goes to a
crew of coding agents that run on their own.

- **Memory that lasts**: append-only ledger, sourced facts, tasks and a short
  "Now" note. Claims about the past cite a record; unknowns get "I don't have that".
- **Session rotation**: rebuilt from memory at 40% context, after a task closes,
  or after a turn cap. No compaction.
- **Agent crew**: Claude Code, Codex, opencode, pi, Kimi or agy workers, each in
  its own git worktree and tmux session, supervised with zero tokens.
- **Fallback chain**: on a usage limit, switch to another Claude account, Codex
  or Kimi, and come back later.
- **Nightly sleep**: consolidates the day into facts and a digest; a quick pass
  pulls facts out of the conversation about every hour in between.
- **Search by meaning**: a small local CPU embedding model (no API) fused with
  keyword search, so "crash" also finds "freeze".
- **Project pages**: one short living summary per project, citing its facts,
  tasks and messages, loaded when a message is about that project.
- **Skills and EXP**, OSINT and design playbooks, voice replies (ElevenLabs).
- Web UI, terminal chat, Docker.

Tested over 520 turns: 100% recall of direct questions, no invented answers
(`docs/eval.md`).

## Quick start

Needs Node 22.18+, pnpm, git, tmux and a logged-in
[Claude Code](https://claude.com/claude-code) CLI. Other agent CLIs are optional.

```sh
git clone https://github.com/thekbbohara/wednesday.git && cd wednesday
cp env.example .env     # optional, every key is documented inside
pnpm install
pnpm build              # web UI
pnpm start              # http://127.0.0.1:4788
```

| Command | What it does |
|---|---|
| `pnpm start` | Web server, captain, agents, nightly sleep |
| `pnpm chat` | Terminal chat (same memory; agents need `pnpm start`) |
| `./src/cli.ts ask "what are we doing?"` | One turn from a script |
| `pnpm dev` | UI hot reload on :5788, API on :4788 |
| `WEDNESDAY_DATA_DIR=/tmp/wed-demo node test/demo-server.ts` | Scripted captain and fake agents, no tokens |
| `node src/sleep.ts [--dry-run]` | Run the nightly sleep now |
| `node src/sleep.ts --extract` | Run the quick fact pass now (facts and pages, no digest) |
| `nice -n 19 ionice -c 3 node src/memory/embed-index.ts` | Build or catch up the meaning index (the server also does it, niced) |
| `node src/pages.ts list \| show <slug> \| seed <slug> "<title>" "kw1,kw2"` | Project pages; `seed` writes a first version from memory |
| `pnpm mcp` | Memory MCP server alone (needs `WEDNESDAY_DB`) |

Chat commands: `/engine [claude\|codex\|kimi\|agy] [model]`, `/now`, `/tasks`,
`/facts`, `/search <words>`, `/get <F1\|T1\|L1>`, `/rotate`, `/usage`, `/credits`.

## Docker

```sh
cp env.example .env                       # set UID/GID (id -u / id -g), PROJECTS_DIR
docker compose up -d --build              # http://127.0.0.1:4788
docker compose exec wednesday node src/cli.ts
docker compose exec wednesday tmux -L majordomo attach -t majordomo_<name>   # watch an agent
```

- Memory: the `majordomo-data` volume, or a host folder via `WEDNESDAY_DATA=./data`
  (`mkdir -p data` first).
- Mounted: `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.gitconfig`, and
  `PROJECTS_DIR` at the same path.
- Agent CLIs baked in: `--build-arg AGENT_CLIS="@anthropic-ai/claude-code @openai/codex"`.
- Binds 127.0.0.1. Set `WEDNESDAY_TOKEN` before `WEDNESDAY_BIND` (e.g. a Tailscale
  IP), then open `/?token=<token>` once.

## Data folder

Everything lives in `~/.wednesday`: `memory.db`, `settings.json`, `secrets/`,
`runtimes.json`, `skills.json` and agent `worktrees/`. Beside `memory.db`:
`memory-pages.db` (project pages, back it up with memory.db), `memory-vec.db`
(meaning index, a cache: delete it to rebuild) and `models/` (the embedding
model, ~25 MB, downloaded once).

- `WEDNESDAY_DATA_DIR` overrides it.
- If `~/.wednesday` is missing but a legacy `~/.jarvis` exists, that is used,
  with one warning. Move it (stop Wednesday and its agents first):

```sh
scripts/migrate-data-dir.sh           # dry run: blockers and files that mention ~/.jarvis
scripts/migrate-data-dir.sh --apply   # mv ~/.jarvis ~/.wednesday, symlink ~/.jarvis -> it
```

## Configuration

The Settings page (model, engine, Claude account, web access, rotation, sleep)
writes `<data>/settings.json`, which wins over the env. Everything else is in
`env.example`. The ones you are most likely to set:

| Variable | Default | |
|---|---|---|
| `ASSISTANT_NAME` | `Wednesday` | Display name |
| `WEDNESDAY_MODEL` | `opus` | Captain model |
| `WEDNESDAY_FALLBACKS` | none | e.g. `claude:~/.claude-2,codex,kimi` |
| `WEDNESDAY_TOKEN` | none | Web chat secret |
| `WEDNESDAY_BIND` / `WEDNESDAY_PORT` | `127.0.0.1` / `4788` | Listen address |
| `WEDNESDAY_SLEEP_AT` | `04:00` | Nightly sleep; empty turns it off |
| `WEDNESDAY_EXTRACT_EVERY` / `_MINUTES` | `30` / `60` | Quick fact pass: after this many entries, or when the oldest is this old; `0` = off |
| `WEDNESDAY_EMBED_MODEL` | `Xenova/all-MiniLM-L6-v2` | Meaning search model; `off` = keywords only |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude account for every Claude run |

- **Engines**: `/engine codex gpt-5` or the selector in the chat. Codex runs
  with approvals and sandbox bypassed. agy needs an explicit, verified model.
- **Multiple Claude accounts**: `CLAUDE_CONFIG_DIR=~/.claude-work claude`, then
  `/login`; pick it in Settings or as a fallback (`claude:~/.claude-work`).
- **Worker runtimes**: override commands in `<data>/runtimes.json`:

```json
[{ "id": "claude-code", "command": "claude --model sonnet --permission-mode auto" }]
```

- **Skills**: link the playbooks once so workers load them:
  `bash skills/osint/scripts/install-osint.sh`, `bash skills/design/scripts/install-design.sh`.
  OSINT is for legitimate, authorized research only.

## Agents

Spawned by the captain with `pnpm start` running. Each gets a worktree in
`<data>/worktrees/<name>` on its own branch (or the Jira key), runs in tmux on
the `majordomo` socket, and survives restarts. A screen reader with no LLM
wakes the captain only on `report`, `needs`, `exit` or `error`.

## How it works

```
message -> ledger -> prompt [Now + tasks + tail + project pages + recalled facts] -> claude -p --resume
        -> reply -> ledger -> rotate at 40% context | task closed | turn cap | /rotate
```

- `src/memory/store.ts`: SQLite (`node:sqlite`, FTS5). Ledger, facts, tasks,
  Now, sessions, agents. `src/memory/vectors.ts`: local embeddings and RRF
  fusion with FTS5. `src/memory/pages.ts`: project pages.
- `src/mcp/server.ts`: memory and agent tools for the captain.
- `src/captain/`: turn loop, engines, fallback chain. `src/agents/`: supervisor,
  tmux, worktrees. `src/sleep/`: nightly consolidation and the quick fact pass. `web/`: React UI (`DESIGN.md`).

## Tests

```sh
pnpm test            # unit and integration
pnpm typecheck
pnpm test:live       # real Claude (haiku), costs a few cents
```

On a schema mismatch Wednesday refuses to start and prints the fix:
`node src/migrate.ts ~/.wednesday/memory.db` (backs up first).

## Legacy names

Formerly Majordomo. `majordomo` still works as a CLI alias, and every
`WEDNESDAY_*` variable is also read as `MAJORDOMO_*` when the new name is unset.
The `majordomo` tmux socket, MCP namespace, `majordomo/<name>` branches and the
`majordomo-data` volume keep their names so running installs keep working.

## License

MIT. See `LICENSE`.
