# T48 isolated live integration ready for owner approval

Live checkout: `/home/kb26/kb/jarvis`, HEAD `fab3e30888c6a5de20b645a9a0f2944a5a962ec4`.

It is dirty. Five T48 paths overlap owner modifications: `src/server.ts`, `web/App.tsx`, `web/api.ts`, `web/pages.tsx`, `web/styles.css`. Nothing was applied to the original checkout.

Prepared checkout: `/home/kb26/.jarvis/worktrees/runtimecredits-live-review`, branch `majordomo/runtimecredits-live-review`.

- `8928a9c`: exact snapshot of all 18 owner-modified/untracked paths, plus a SHA-256/mode manifest. No credentials or `.env` contents were copied into Git.
- `d87b689`: reviewed T48 commit applied over that snapshot. Only the CSS appended-block conflict needed resolution; both complete blocks were retained. Owner agent answer controls, task replies, design skill, prompt instructions, source and tests are preserved.
- Additional integration evidence/script commit follows these two commits.

Verification: typecheck, production build, diff checks and 53 focused tests pass. The isolated build loaded in the real browser; clicking the Settings link opened `/usages`, displaying ten account cards. `settings-integrated.png` and `usages-integrated.png` are new evidence from this combined checkout. Test selection avoids SQL/database creation; the message-route test uses an in-memory ledger. Original live HEAD, owner edit inventory, bytes and modes were verified unchanged after integration; 13 non-overlapping owner files also match the combined checkout byte-for-byte. All owner bytes remain recoverable exactly in snapshot commit `8928a9c`.

Live process is still Node PID `1468384`, running `src/server.ts` from the original checkout through `pnpm start`. Its terminal shell is still present. No live signal or restart was issued. The read-only preview on 4798 is stopped after verification.

The prepared restart script is syntax checked, **not executed**. Before signalling anything, it rechecks original HEAD, edit inventory, all file hashes/modes, original environment-file hash, the live PID's checkout and server arguments, and the built index. If owner changes drift, it aborts and requires a refreshed integration. It stops only the verified Node server, waits for it to exit, then foreground-execs the isolated server using the original `.env`. It does not create a tmux session, touch the original source checkout, change login state or configure system services. Shared data remains `/home/kb26/.jarvis`; settings still select Wednesday/Codex and `~/.claude-work`. No new database migration is introduced.

Only after explicit owner approval, run in the existing owner terminal/pane:

```sh
T48_OWNER_APPROVED=1 /home/kb26/.jarvis/worktrees/runtimecredits-live-review/reports/T48-integration/restart-after-owner-approval.sh
```

Then check `http://127.0.0.1:4788/usages` and `/api/healthz`. If the live PID has legitimately changed before approval, inspect it first and pass the verified value as `T48_LIVE_PID`; the script still validates the checkout and arguments.

Equivalent launch after the approved old process has exited:

```sh
cd /home/kb26/.jarvis/worktrees/runtimecredits-live-review
env -u MAJORDOMO_AGENT -u MAJORDOMO_URL -u MAJORDOMO_SESSION -u MAJORDOMO_DB \
  -u MAJORDOMO_DATA_DIR -u CLAUDE_CONFIG_DIR -u HOST -u PORT -u ASSISTANT_NAME \
  /home/kb26/.local/share/pi-node/node-v22.23.2-linux-x64/bin/node \
  --env-file-if-exists=/home/kb26/kb/jarvis/.env \
  --disable-warning=ExperimentalWarning src/server.ts
```

This command is a prepared launch, not a performed deployment. Original owner edits and original checkout remain untouched.
