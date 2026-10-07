# T50: Wednesday rename and runtime audit

Branch: `majordomo/wedrename2`, base `858d347`. Initial worktree was clean.
Audit and validation: 2026-10-07, approximately 17:58-18:04 America/New_York.

## Delivered

- Wednesday package name, primary CLI bin (legacy `majordomo` alias retained),
  UI title/default display name, prompts, help/errors, docs and installer text.
- `WEDNESDAY_*` config, HTTP binding, MCP and hook environment names take
  precedence over legacy aliases. Child launches emit both matching names.
- New installations use `.wednesday`; existing `.majordomo`, then `.jarvis`
  retain their original precedence. No directories or databases were moved.
- New auth cookie `wednesday_token`, old cookie and bearer auth accepted.
- Compose service/image `wednesday`; historical volume preserved. Default tmux
  socket, worker branches/session prefixes, MCP tool namespace, drafts, progress
  and ledger identifiers remain stable for existing conversations and workers.
- `deploy/wednesday-telegram.service` reflects the observed owner configuration
  and adds `Conflicts=majordomo-telegram.service`. This machine-specific template
  was verified but neither installed nor activated. Paths remain configurable
  in the unit; retaining `tggateway` and `.jarvis` paths is intentional.
- agy no longer automatically selects the failed Opus model. A captain/fallback
  with no explicit model fails before spawning or writing configuration. Explicit
  models remain supported. Opus UI entry says access unverified, and model-access
  errors are sanitized into an actionable message.

## Telegram duplicate: confirmed end-user failure

Read-only systemd/process audit:

| Unit | MainPID | State | Enablement |
| --- | --- | --- | --- |
| majordomo-telegram | 545 | active | disabled |
| wednesday-telegram | 2772094 | active | enabled |

Both use the same Node binary, env file `/home/kb26/kb/jarvis/.env`, gateway
`/home/kb26/.jarvis/worktrees/tggateway/src/telegram/gateway.ts`, and worktree.
Journal entries from both repeatedly report Telegram getUpdates HTTP 409:
`Conflict: terminated by other getUpdates request`.
Disabled does not mean stopped. Keep the enabled Wednesday unit and stop the old
consumer during an owner-approved maintenance action. No gateway was changed.
The gateway source is on a separate worktree and is not in this branch; the
existing `MAJORDOMO_URL` in the template is deliberate gateway compatibility.

## Opus evidence and remaining limitation

Installed `agy --version`: 1.3.1. Read-only `agy models` advertises exactly
`claude-opus-4-6-thinking` with label `Claude Opus 4.6 (Thinking)`.
Installed logs `cli-20261007_173428.log` and `cli-20261007_174517.log` show the
resolver propagating that label to the backend. Other log entries warn that the
ID is initially absent from local config. Installed settings select Gemini 3.8
Flash (Medium), with no custom Opus mapping. Binary strings contain other Opus
names, but strings alone do not establish a valid CLI/account-access mapping.

The installed guide links to the official reference:
https://antigravity.google/docs/cli/reference
It documents model selection but establishes no alternative accessible Opus ID.
There is therefore **no verified replacement identifier** under the no-inference
constraint. The known CLI identifier is advertised, while account access remains
unverified after the two reported failures. Do not substitute a guessed ID or
switch the owner to agy. Runtime default protection is delivered; accessible
Opus activation remains blocked pending separate verification.

Read-only `/home/kb26/.jarvis/settings.json`: engine `codex`, empty engineModel,
Claude model `opus`, account `~/.claude-work`. This file was not changed.
Captain PID 2789116 still runs `node ... src/server.ts` from
`/home/kb26/kb/jarvis`, parent pnpm PID 2789036. No update prompt was invoked.

## Verification

- `pnpm typecheck`: passes both server and web TypeScript projects.
- `pnpm build`: passes, 279 modules; built HTML title Wednesday.
- 60 tests pass in 12 files: wednesday-config, agy-captain, settings, runner,
  kimi, agy-usage, agents-hooks, agents-activity, credits, credits-command,
  design, osint. CLI runner tests use stand-ins, not model inference.
- New smoke starts real HTTP on ephemeral loopback with a plain object memory
  fixture, serves the built page, verifies both cookie names, routes MCP
  `captain_engine_set` through HTTP, executes a stand-in captain turn and checks
  Wednesday system prompts and matching legacy/new MCP environment paths.
- Environment precedence, empty-value behavior, historical-directory precedence,
  implicit-model fail-before-launch, explicit model and conversation resume checked.
- `systemd-analyze --user verify deploy/wednesday-telegram.service`: passes.
- `docker compose config --quiet`: passes. A custom host port test confirms
  Wednesday port precedence, fixed container listen port 4788 and retained
  `majordomo-data` volume. No Docker container was started.
- `git diff --check`: passes. No repository lint script is defined.

Full suite intentionally not run: many tests instantiate SQLite and execute
CREATE/ALTER schema SQL or start tmux sessions, prohibited by this task. No
migrations/schema SQL, real model calls, new tmux sessions, service changes,
public operations, login, sudo, pushes, or PRs were performed. OSINT negative
fixture tests print expected missing-argument/dependency diagnostics and pass.

## Safe activation steps for Wednesday/owner (not executed)

1. Review the commit and preserve owner work before integrating. The live checkout
   has modified README, captain prompt, supervisor, MCP, server, chat, several
   tests and web files, plus untracked design skill/tests and `web/Reply.tsx`.
   Do not reset, replace files wholesale, or merge this stale base over them.
   Generate a reviewable patch and check applicability first:

   ```sh
   git -C /home/kb26/kb/jarvis status --short
   git -C /home/kb26/kb/jarvis diff --binary > /tmp/T50-owner-before.patch
   git -C /home/kb26/.jarvis/worktrees/wedrename2 diff 858d347 majordomo/wedrename2 --binary > /tmp/T50-rename.patch
   git -C /home/kb26/kb/jarvis apply --check /tmp/T50-rename.patch
   ```

   The check may fail on overlapping owner changes. Resolve integration in a
   review checkout; the patch does not back up untracked files, so preserve those
   separately before any integration. Do not proceed to restart until reviewed
   owner changes and this rename coexist and checks pass.

2. Resolve the duplicate without restarting the surviving Wednesday gateway:

   ```sh
   systemctl --user disable --now majordomo-telegram.service
   systemctl --user show majordomo-telegram wednesday-telegram -p MainPID -p ActiveState -p UnitFileState
   journalctl --user -u wednesday-telegram -n 30 --no-pager
   ```

   Expect old inactive, Wednesday active/enabled, and no new 409 conflicts after
   the previous long poll expires. Retain the old service file for rollback.

3. At a later approved gateway maintenance window, review and install the
   conflict guard. Backup the current owner unit first:

   ```sh
   cp -a /home/kb26/.config/systemd/user/wednesday-telegram.service /home/kb26/.config/systemd/user/wednesday-telegram.service.T50-backup
   diff -u /home/kb26/.config/systemd/user/wednesday-telegram.service /home/kb26/.jarvis/worktrees/wedrename2/deploy/wednesday-telegram.service
   cp /home/kb26/.jarvis/worktrees/wedrename2/deploy/wednesday-telegram.service /home/kb26/.config/systemd/user/wednesday-telegram.service
   systemctl --user daemon-reload
   systemctl --user restart wednesday-telegram.service
   ```

   Recheck the unit PIDs and journal. Do not start both services. If rollback is
   necessary, restore the backup and reload, keeping only one consumer active.

4. In the reviewed integrated captain checkout, run `pnpm typecheck` and
   `pnpm build`. Use the owner's existing captain launcher/pane to stop the old
   server at an approved boundary, then launch from that same pane (never launch
   alongside PID 2789116 on port 4788):

   ```sh
   cd /home/kb26/kb/jarvis
   ASSISTANT_NAME=Wednesday WEDNESDAY_DATA_DIR=/home/kb26/.jarvis WEDNESDAY_TMUX_SOCKET=majordomo pnpm start
   ```

   Existing `.env` and saved settings remain effective, including Codex. Confirm
   Wednesday in the UI, unchanged workers, and MCP tool routing without an agy
   switch. Do not rename branches, worktrees, sockets or `.jarvis`. For Docker,
   use the existing Compose project name and verify the existing named volume
   before replacing the service; do not run a second project against a new volume.
