# T49 expanded live activation

Activated source commit `704bce73819782407681c069ee8bed58cfa3b65d` after typecheck, 39 focused tests, production build and isolated real-browser preview passed. The existing hosting pane `%9` in `majordomo_runtimecredits`, socket `majordomo`, now runs PID `2533269` from `/home/kb26/.jarvis/worktrees/agysetup`. Health and agents APIs pass. No new tmux session was created.

Codex stayed selected throughout implementation, verification and restart. After the new service was healthy and preservation checks passed, the actual live Settings UI selected `agy`. API and persisted settings confirm captain model `claude-opus-4-6-thinking`. The real Command Center composer also selects agy. This applies at the next captain turn; no post-activation MCP call is needed. The last memory session provider remains Codex and no inference turn was submitted. New agy workers default to `agy --model gemini-3.8-flash-medium`; existing workers remain unchanged. Explicit model overrides remain supported.

`agy-opus-settings-live.png` shows the live engine/model selection. `settings-to-agy-usage-live.png` records the actual Settings-to-Usage browser flow. The credits API and browser report all four Gemini and Claude/GPT weekly/five-hour windows at 100% remaining, with separate AI credits at 0. These are provider-reported allowances, not a promise that a model request will succeed. Native CLI inspection reached the custom Opus input prompt without inference; real model-driven MCP and conversation resumption remain untested under the no-inference constraint, as documented in the implementation report.

`verification.json` records read-only preservation checks after the selection: every existing row in all eight tables unchanged, schema unchanged, owner dirty checkout unchanged, prior live checkout unchanged, existing worker panes and PIDs unchanged. Protected environment/runtime/credential file hashes match; only the authorized settings engine/model fields changed. No schema SQL, test DB initialization, paid inference, login, credential change or new tmux session occurred in this expanded implementation/activation. The earlier test constraint violation remains disclosed in the original T49 report and was not repeated.

## Rollback

For an engine-only rollback, use Settings to select Codex, or the local config-only API while this build is running:

```sh
curl --fail-with-body -X POST http://127.0.0.1:4788/api/captain/engine \
  -H 'Content-Type: application/json' -d '{"engine":"codex"}'
```

If API authentication is enabled, use the existing authorized client instead of exposing a token. This selection applies at the next turn and does not erase sessions or data.

For a full service rollback, FIRST select Codex through the running new build and verify `/api/settings`; the old build does not support persisted engine agy. Verify captain idle (`captain.lock` absent), no sleep currently due, live PID/cwd, unchanged existing schema and clean prior checkout before stopping. Stop only the verified hosting PID, wait for it to exit, then respawn the same hosting pane with the preserved prior checkout. Never stop the other worker panes.

```sh
readlink /proc/2533269/cwd
tmux -L majordomo display-message -p -t %9 '#{pane_pid} #{pane_dead}'
git -C /home/kb26/.jarvis/worktrees/runtimecredits-live-review status --porcelain
git -C /home/kb26/.jarvis/worktrees/runtimecredits-live-review rev-parse HEAD
# Expected PID 2533269, cwd agysetup, prior clean at 17046af.
# After the guards above, and only if this PID still owns the hosting pane:
kill -TERM 2533269
# Wait until /proc/2533269 no longer exists before respawning.
tmux -L majordomo respawn-pane -k -t %9 \
  -c /home/kb26/.jarvis/worktrees/runtimecredits-live-review \
  'exec env -u MAJORDOMO_AGENT -u MAJORDOMO_URL -u MAJORDOMO_SESSION -u MAJORDOMO_DB -u MAJORDOMO_DATA_DIR -u CLAUDE_CONFIG_DIR -u HOST -u PORT -u ASSISTANT_NAME PATH="/home/kb26/.local/bin:$PATH" /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node --env-file-if-exists=/home/kb26/kb/jarvis/.env --disable-warning=ExperimentalWarning /home/kb26/.jarvis/worktrees/runtimecredits-live-review/src/server.ts'
curl --fail http://127.0.0.1:4788/api/healthz
```

Rollback was prepared, not executed. No owner decision or login is needed for the completed setup; the next normal captain turn exercises real inference.
