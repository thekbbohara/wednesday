# T50 recovered integration

Recovered on 2026-10-07 by wedrecover. Review checkout:
`/home/kb26/.jarvis/worktrees/t50-reviewed`, branch `majordomo/t50-reviewed`.
The existing owner snapshot commit `8ddc4dd` was reused, as was the staged
integration of rename `7a37e91` and usage/agy base `858d347`. No integration was
recreated and no original source file was changed.

Owner preservation: all tracked and nonignored untracked files (including
original untracked design skill, chat test and Reply component) were snapshotted.
Ignored .env is privately preserved in the existing backup directory. Dependencies,
build products and runtime data are excluded from that source snapshot and untouched
in the original checkout. Backup: `/home/kb26/.jarvis/reviews/T50-20261007-180643`.
`verify-owner.py` checks every saved source hash/mode, .env, HEAD and git status.

## Verified

- Server/web typecheck and production build passed (279 modules).
- 60 tests passed across 12 safe files listed in reports/T50/README.md.
- 13 additional tests passed: routes, thread, chat and agents-runtimes. The
  worker test uses object memory and mocked tmux; no database/session is created.
  Fixed its stale exact environment assertion to include Wednesday aliases.
- Real loopback HTTP plus MCP SDK smoke passed, 19 tools; engine switch reaches
  HTTP, both auth cookies pass in the regression suite. Stand-in runner test
  checks Wednesday prompt and paired environment paths. Preview /usages produced
  a reply with zero runner calls, nonusage inference was blocked, settings were
  ephemeral and SQLite was never instantiated.
- Browser clicked Settings and its usage link to /usages. Wednesday title/name,
  Codex selected, data path retained, runtime usage screen verified. Fresh captures:
  recovered-settings.png and recovered-usages.png. Previous agy unverified-model
  screenshot and branding captures remain alongside them.
- Compose config, user service verification and git diff whitespace check pass.
  No lint script exists. Full suite is excluded because it opens SQLite schema
  or creates tmux sessions. No model inference, migration, schema SQL, captain
  restart, new tmux, sudo, public push or PR occurred during recovery.

Live audit: captain Node PID 22689, parent pnpm 22671, shell 22010, terminal
`pts/1`, cwd `/home/kb26/kb/jarvis`, in a Kitty scope. It is not an observed tmux
captain pane. Existing worker tmux sessions remain unchanged. Settings still
select Codex with empty engineModel. Explicit agy models remain supported;
implicit model selection fails before launch/write; Opus access is unverified.

Telegram: old unit inactive/disabled/PID 0, Wednesday active/enabled/PID 543.
The prior worker's guard evidence records a unit edit and daemon reload without
restart, but that surviving-PID entry is historical. Current journal records a
later start at 18:16 and initial DNS EAI_AGAIN errors. No duplicate consumer was
observed; successful Telegram delivery was not tested or inferred.

## Exact same-terminal activation and rollback (prepared, not executed)

Wednesday/owner must choose the restart boundary. Use the existing Kitty terminal
`pts/1` running the captain. Do not paste launch commands in a worker pane and do
not create a session. First rerun preservation verification:

```sh
python3 /home/kb26/.jarvis/worktrees/t50-reviewed/reports/T50-integration/verify-owner.py
```

At the approved boundary, Ctrl-C in that existing captain terminal and wait for
pnpm/Node to exit. Check `ss -ltnp 'sport = :4788'` shows no listener before
launching. Then in the SAME terminal:

```sh
cd /home/kb26/.jarvis/worktrees/t50-reviewed
env -u MAJORDOMO_AGENT -u WEDNESDAY_AGENT -u MAJORDOMO_URL -u WEDNESDAY_URL -u MAJORDOMO_SESSION -u WEDNESDAY_SESSION -u MAJORDOMO_DB -u WEDNESDAY_DB ASSISTANT_NAME=Wednesday WEDNESDAY_DATA_DIR=/home/kb26/.jarvis WEDNESDAY_TMUX_SOCKET=majordomo /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node --env-file=/home/kb26/kb/jarvis/.env --disable-warning=ExperimentalWarning src/server.ts
```

This reads the original .env without copying it to git and retains the original
data, settings, legacy socket and worker identities. Confirm existing authenticated
UI shows Wednesday and Codex; check workers reconnect and MCP routes. No schema
commands or migration are prescribed. Normal server startup opens the existing
memory store, so live activation remains outside this recovery's no-schema execution.

Rollback in that SAME terminal: Ctrl-C integrated server, wait for exit and verify
4788 is free, then restore the original launch:

```sh
cd /home/kb26/kb/jarvis
pnpm start
```

Do not reset/merge the original checkout or start the old Telegram unit. This is a
code rollback only; it preserves data and does not reverse ledger changes made
after activation. Saved Codex settings are unchanged by this recovery.
