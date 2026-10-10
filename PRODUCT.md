# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner (a developer) is the primary and effectively only user. They talk to
one assistant ("Wednesday") in a single chat all day, keep it open next to dark
terminals, and run a crew of AI coding agents through it. Other people cloning
the public repo are secondary and self-serve; they do not steer product
decisions (confirmed 2026-10-09).

## Product Purpose

Wednesday is a personal AI assistant with one permanent chat. Memory lives in a
SQLite file outside the model session, so model sessions rotate freely and
nothing is forgotten. Real work is delegated to a crew of coding agents that
run in their own git worktrees and tmux sessions, supervised at zero token
cost to the captain.

Success means: the owner states intent in chat and the outcome happens without
follow-up nagging; questions about the past are answered with citations to real
records; agent work proceeds until it needs the owner.

## Positioning

"One chat, forever": an append-only ledger, sourced facts, tasks and a "Now"
note that survive session rotation - no compaction. Neighboring assistants
compact or lose history inside the context window; Wednesday rebuilds each new
session from durable memory and can cite the exact record behind any claim.

## Operating Context

- Runs locally (or in Docker) on the owner's machine; web UI at
  `127.0.0.1:4788`, terminal chat CLI, memory MCP server.
- Data lives in `~/.wednesday` (`memory.db`, `settings.json`, `secrets/`,
  `runtimes.json`, `skills.json`, agent `worktrees/`); `WEDNESDAY_DATA_DIR`
  overrides it.
- Agents are spawned by the captain into worktrees and tmux on the
  `majordomo` socket; branch naming follows Jira ticket keys (AGENTS.md rule).
- The owner works with Jira (sarallagani.atlassian.net) and multiple LLM
  provider accounts with usage allowances; fallback switching between accounts
  and runtimes is a daily reality.
- Nightly sleep consolidates the day into facts and a digest.
- The web UI stays open all day beside dark terminals; the light theme is an
  operating requirement, not a preference.

## Capabilities and Constraints

- Memory: append-only ledger, sourced facts, tasks, "Now" note; FTS5 search;
  ids like F3, T1, L42 are user-facing terminology and render as chips.
- Session rotation at 40% context, after a task closes, or after a turn cap;
  rotation is invisible to the user.
- Engines: Claude Code, Codex, Kimi, agy with a fallback chain on usage
  limits; multiple Claude accounts via separate config dirs.
- Worker runtimes overridable via `runtimes.json`; agent CLIs are external
  dependencies, not bundled.
- Skills and EXP system; OSINT and design playbooks; voice replies
  (ElevenLabs).
- Settings page writes `settings.json`, which wins over env vars.
- Schema mismatch refuses startup and prints a manual migration command;
  no automatic migrations.
- Accessibility: no formal target (confirmed 2026-10-09). Follow platform
  defaults and fix obvious breakage; the light, all-day-open UI is the one
  established comfort constraint.

## Brand Commitments

- Name: "Wednesday" (overridable via `ASSISTANT_NAME`). Tagline: "You tell
  me, I'll handle everything else without nagging."
- Legacy name Majordomo persists in the tmux socket, MCP namespace,
  `majordomo/<name>` branches, the `majordomo-data` volume and the CLI alias;
  every `WEDNESDAY_*` env var also reads as `MAJORDOMO_*`.
- MIT license; public repo, but a personal tool first (confirmed 2026-10-09).
- Visual world is established in `DESIGN.md` (game studio, light, agent-hq
  roster) and is binding for all surfaces until deliberately replaced there.

## Evidence on Hand

- `docs/eval.md`: tested over 520 turns, 100% recall of direct questions, no
  invented answers.
- `reports/` and `evidence/`: evaluation reports per milestone (T48-T80).
- No customers, testimonials, benchmarks, pricing or marketing claims exist;
  future work must not fabricate them.

## Product Principles

1. One chat, forever - durable memory outside the model session is the
   foundation; no compaction, nothing forgotten.
2. Don't nag - state intent once; agents and the captain carry it to
   completion and surface only genuine blockers.
3. Cite or admit - every claim about the past points at a record, or the
   answer is "I don't have that". Never invent.
4. Personal tool first - owner-centric defaults win over hypothetical users;
   the open repo stays self-serve.
5. Keep it running - legacy names, data folders and running installs keep
   working across upgrades; local-first, Docker-parity.
