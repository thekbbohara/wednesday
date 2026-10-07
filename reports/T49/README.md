# T49: Antigravity runtime and real usage

Prepared on `majordomo/agysetup`, starting exactly at live build `17046af96dee7bb79e35a5e8a4d208d208ca5acc`. Nothing was activated live, pushed, merged or published.

## Findings and changes

`/home/kb26/.local/bin/agy` is Antigravity CLI 1.3.1, not the Gemini CLI. Its help supports interactive agents, custom agents (`--agent`), model selection, permission modes, print mode and stream JSON. `agy models` successfully listed Gemini, Claude and GPT-OSS models using the existing account. No custom agents were listed by `agy agents`.

The existing `agy` runtime already launches the interactive agent through the supervisor. Its name now says `agy (Antigravity)`. Its permission policy stays at the CLI's existing `request-review`; no bypass flags or paid-credit configuration were added. Screen-idle completion remains the existing hookless fallback. An inference turn and its completion were deliberately not tested, because this job forbids spending. No new dedicated agent protocol or custom-agent installation is necessary for the existing interactive worker path.

Real startup in a temporary pane of the existing `majordomo_agysetup` session reached the workspace trust menu, then the agent input prompt after trusting this worker's own worktree. This exposed a real bug: `enter Confirm` was not recognized as a menu footer, so the supervisor could treat a trust question as idle and type its brief into it. The classifier now recognizes that footer and identifies the trust prompt. The new regression test uses the observed trust screen. The temporary pane was closed; live hosting and ctxedit panes were preserved.

The installed CLI's own changelog documents that `-p /usage` and `-p /credits` have native read-only answers, with JSON output, without starting a turn, spending quota, or leaving a conversation. The collector invokes only those two fixed commands through `execFile`, with a 15-second print timeout, 20-second process timeout and bounded output. It reads no credential content. Credential-file metadata invalidates the 60-second cache after account changes. A synthetic credential root never launches the real user's CLI. Unsupported/error/inference JSON is rejected; subprocess errors never expose their raw text. Independent failures produce partial availability; complete failure produces unavailable or explicitly stale data.

`agy-usage-evidence.json` records only the sanitized structured result: four shared model-group windows, all reporting 100% remaining, plus zero AI credits, zero inference turns and zero tokens. Resets are provider-reported. No token-to-credit estimates are used. CLI `/config` reported `useG1Credits=false`. Existing login works; no owner login is currently needed. The OAuth file hash was identical before and after the collector and browser checks. Majordomo initiates no login, refresh, purchase or credential-writing operation; authentication remains managed by the installed CLI. The CLI may require the owner to repair an expired login later.

## Verification

- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `node node_modules/vitest/vitest.mjs run test/agy-usage.test.ts test/credits.test.ts test/credits-command.test.ts test/agents-activity.test.ts test/agents-runtimes.test.ts`: 5 files, 31 tests passed. These tests use mocks or plain files, with no database initialization or tmux session creation.
- `git diff --check`: passed.
- Real browser: live `/usages` first showed agy unavailable. Read-only isolated preview on port 4799 then showed its four allowance bars, reset times and separate credits, using existing DESIGN.md components and styling. The Refresh button was exercised. `live-before.png` and `agy-quotas-preview.png` capture the before/after evidence. No UI styling changes were necessary.
- Live PID `2351027` remained running from `/home/kb26/.jarvis/worktrees/runtimecredits-live-review`, HEAD `17046af`. No operation edited the original `/home/kb26/kb/jarvis` checkout. Its current dirty inventory has drifted from the task's historical 18 paths to 16; this work did not copy or overwrite it.

**Verification constraint violation:** An initial `pnpm test -- <file list>` invocation unexpectedly passed `--` through to Vitest, causing the full existing suite to run. It completed with 27 files passed, 1 skipped, 168 tests passed and 3 skipped before the attempted stop. Existing tests initialized disposable fixture databases and created throwaway test tmux sessions, violating this job's no-schema-initialization and no-new-session constraints. No live database migration or live hosting-session stop was issued. Remaining verification used the direct, explicit Vitest selection above. Do not use the mistaken command to repeat this verification.

## Review and setup

Review the commit in this worktree. No installation, login, account or credential change is required on this machine. The server's PATH must contain `/home/kb26/.local/bin` so both workers and the collector find `agy`. Future installations must support the documented read-only JSON slash commands; this implementation was verified against 1.3.1. An older unsupported binary must be upgraded by the owner before enabling this collector.

To inspect without inference:

```sh
agy --help
agy models
agy --print /usage --output-format json --print-timeout 15s
agy --print /credits --output-format json --print-timeout 15s
```

To repeat the isolated browser check, after installing this checkout's dependencies with `pnpm install --frozen-lockfile` and building:

```sh
cd /home/kb26/.jarvis/worktrees/agysetup
PORT=4799 /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node \
  --env-file-if-exists=/home/kb26/kb/jarvis/.env \
  --disable-warning=ExperimentalWarning test/credits-preview.ts
```

Open `http://127.0.0.1:4799/usages`. This preview instantiates no Memory/database and blocks write API routes except its in-memory usage-command response. Its startup message names the historical default port 4798; the actual port above is 4799.

## Captain-only activation steps, not executed

After captain verification, the simplest deployment serves this reviewed worktree directly, preserving the original owner checkout and the prior live checkout for rollback. First ensure that no newer live changes need integration, `git status --short` is clean, dependencies and `dist/index.html` exist, and the intended shared data is still `/home/kb26/.jarvis`. Recheck live PID, cwd and arguments before stopping anything:

```sh
ps -p 2351027 -o pid,args
readlink /proc/2351027/cwd
git -C /home/kb26/.jarvis/worktrees/runtimecredits-live-review rev-parse HEAD
tmux list-panes -t majordomo_runtimecredits -F '#{pane_id} #{pane_current_command}'
```

Only after captain verification, stop the verified Node PID with `kill -TERM 2351027`, wait for that PID to exit, and run this foreground command in the existing `majordomo_runtimecredits` hosting pane `%9`. Do not kill the tmux session, pane `%8`, or ctxedit. If the PID or checkout differs, reassess before sending a signal.

```sh
cd /home/kb26/.jarvis/worktrees/agysetup
env -u MAJORDOMO_AGENT -u MAJORDOMO_URL -u MAJORDOMO_SESSION -u MAJORDOMO_DB \
  -u MAJORDOMO_DATA_DIR -u CLAUDE_CONFIG_DIR -u HOST -u PORT -u ASSISTANT_NAME \
  PATH="/home/kb26/.local/bin:$PATH" \
  /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node \
  --env-file-if-exists=/home/kb26/kb/jarvis/.env \
  --disable-warning=ExperimentalWarning src/server.ts
```

Verify `/api/healthz`, `/usages`, and `/usages` in chat. Start an actual agy task only when the captain authorizes inference; choose runtime ID `agy`. First-run workspace trust is handled automatically only for worktrees Majordomo created; existing arbitrary folders still require an owner answer. Tool permission requests remain reviewable. To roll back after stopping only the new verified server PID, use the same foreground launch from `/home/kb26/.jarvis/worktrees/runtimecredits-live-review`.
