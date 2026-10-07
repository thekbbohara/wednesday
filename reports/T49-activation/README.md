# T49 local activation completed

Captain explicitly authorized local activation of reviewed code `4db30a6` on 2026-10-07. The worker and prior live checkouts were clean, with exactly the expected HEADs. Live PID 2351027, cwd, executable, arguments and hosting pane were verified before any signal. The shared database was opened read-only for SELECT-only checks: existing schema v3, captain unlocked, nightly sleep not due, and all running worker rows matched live panes. Thus server startup took the existing-schema path, with no initialization or migration SQL.

Only the verified old server received SIGTERM. Existing pane `%9` in tmux socket `majordomo`, session `majordomo_runtimecredits`, was retained with `remain-on-exit=on` and respawned from the reviewed worktree. No new tmux session or worker was created. No tests ran during this activation.

Actual live server:

- PID: `2462644`
- Cwd: `/home/kb26/.jarvis/worktrees/agysetup`
- Runtime code: `4db30a6b879865b4c1e0e5b3e681c609a831afef`
- Pane: existing `%9`, session `majordomo_runtimecredits`, socket `majordomo`
- Shared memory: `/home/kb26/.jarvis/memory.db`
- URL: `http://127.0.0.1:4788`

`verification.json` records the post-activation results. `/api/healthz` returned `{ "ok": true }`. `/api/agents` succeeded. `/api/credits` returned the agy account as available with four quota windows, each 100% remaining, and zero AI credits. The provider reported weekly resets at `2026-10-14T19:42:38Z` and five-hour resets at `2026-10-08T00:42:38Z`. These are live reported allowances, not estimates. No inference prompt was submitted, no login was attempted, no purchase was made, and the agy OAuth file hash remained unchanged.

The real browser opened Settings and followed its `/usages` link. `settings-live.png` captures Settings; `settings-to-agy-usage-live.png` captures the resulting live agy quota card. The browser console had no errors. No UI or application source changes were made after captain review. This evidence commit adds only local activation records.

No loss was observed. Every existing row in all eight primary tables matched its pre-restart SHA-256 fingerprint, with unchanged counts: meta 5, ledger 2449, facts 116, tasks 49, now 1, sessions 44, agents 65, exp 113. The schema fingerprint also matched. Running workers `agysetup`, `ctxedit`, and `runtimecredits` retained their rows and original pane PIDs. Original owner dirty-path inventory, file bytes, modes and HEAD matched the baseline; the prior live checkout matched all tracked bytes, modes and HEAD. The original environment file, settings, runtime overrides and agy credential file also matched their baseline hashes. Raw database content and credentials were not saved in these artifacts.

## Rollback, prepared only

The prior checkout remains clean at `17046af96dee7bb79e35a5e8a4d208d208ca5acc`. To roll back, first recheck the live PID/cwd/command and pane, idle captain, existing schema v3 and whether sleep is due. Abort if the PID, checkout or pane has changed, or if stopping the server would interrupt a captain turn. The read-only preflight used for activation is still available at `/tmp/t49-activate.mjs` for inspection; do not rerun it because it targets the now-retired old PID.

After verifying those guards, the following switches only the existing hosting pane back to the preserved prior checkout. It creates no new session and changes no source, settings or credentials:

```sh
ps -p 2462644 -o pid,args
readlink /proc/2462644/cwd
 tmux -L majordomo display-message -p -t %9 '#{pane_pid} #{pane_dead}'
git -C /home/kb26/.jarvis/worktrees/runtimecredits-live-review rev-parse HEAD
```

Expected: PID 2462644 is Node serving `/home/kb26/.jarvis/worktrees/agysetup/src/server.ts`, cwd is agysetup, pane reports `2462644 0`, and prior HEAD is `17046af`. Then:

```sh
kill -TERM 2462644
```

Wait for that exact PID to disappear, then run:

```sh
tmux -L majordomo respawn-pane -t %9 \
  -c /home/kb26/.jarvis/worktrees/runtimecredits-live-review \
  'exec env -u MAJORDOMO_AGENT -u MAJORDOMO_URL -u MAJORDOMO_SESSION -u MAJORDOMO_DB -u MAJORDOMO_DATA_DIR -u CLAUDE_CONFIG_DIR -u HOST -u PORT -u ASSISTANT_NAME PATH="/home/kb26/.local/bin:$PATH" /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node --env-file-if-exists=/home/kb26/kb/jarvis/.env --disable-warning=ExperimentalWarning /home/kb26/.jarvis/worktrees/runtimecredits-live-review/src/server.ts'
```

Verify health and the new hosting PID/cwd. Do not kill ctxedit, pane `%8`, or either tmux session. No rollback was executed.
