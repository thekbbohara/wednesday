# T48: Wednesday runtime usage and credits

Implemented in Wednesday's interface, including owner clarifications L2407 and L2410:

- Dedicated `/usages` browser page, with a prominent "View all runtime usage and credits" link at the top of Settings and a navigation button.
- `/usages` and `/usage` chat commands plus terminal `ask` support. Commands use the same collectors, return a concise timestamped report and bypass inference.
- Independent allowance windows, provider reset dates in the browser's local timezone, monetary credit balances separate from key caps, source/account attribution, check/report timestamps and explicit unavailable/stale reasons.
- Read-only, concurrent collectors with a 60-second per-account cache, concurrent request coalescing, 10-second request deadlines, credential-file change invalidation, safe errors and preserved stale snapshots on failure. A late request cannot overwrite a newer credential snapshot.
- DESIGN.md extends the existing light roster design. No new design system or dependencies.

## Provider results in this environment

| Runtime/account | Verified result |
| --- | --- |
| Claude default `~/.claude` | Actual Anthropic OAuth 5-hour and weekly usage windows, resets, and an additional provider-named USD allowance. The opaque allowance retains its provider key; eligibility is not guessed. Extra usage is disabled. |
| Claude configured `~/.claude-work` | Actual 5-hour and weekly usage windows and reset times. Configured/fallback Claude directories are deduplicated by path. |
| Codex `~/.codex` | Actual ChatGPT account allowance windows and separate purchased-credit balance; account id attached. |
| pi / openai-codex | Actual allowance for pi's own OAuth account, which differs from the Codex CLI account. |
| pi / OpenRouter | Actual account funds from reported purchased credits minus reported account usage, separate from the per-key spending cap. No cap does not imply unlimited account funds. |
| pi / Anthropic | Unavailable; HTTP 401 and 429 observed across read-only checks. Errors are shown without credential refresh. |
| Kimi | Both local credentials files contain empty access/refresh token placeholders. No local API key was present. The read-only `/usages` collector supports populated Kimi Code credential files and recognized allowance payloads; real authenticated Kimi quota could not be verified here. |
| OpenCode | No readable provider entries in its local `auth.json`. Supports recognized Anthropic, OpenAI/Codex and OpenRouter entries when available; those OpenCode integrations remain fixture-only here. |
| agy / other runtime providers | Explicit unavailable reason when no supported collector exists. |

Values change as other agents work; the saved `usages.txt` is a timestamped observation, not a current guarantee. Internal Anthropic/ChatGPT quota APIs may change. Parsers fail explicitly on unrecognized schemas. No session token/context estimates are used.

Scope is configured Claude directories, standard credential stores and the process's `CODEX_HOME`, `KIMI_CODE_HOME`, `PI_CODING_AGENT_DIR`, and `XDG_DATA_HOME` roots. Shell wrappers and launch profiles are not executed or guessed; custom routing gets an explicit unavailable entry. Keyring-only credentials, environment-only provider keys and arbitrary custom provider endpoints are not collected. Credentials never leave the server except as authentication to fixed first-party quota hosts; redirect following is disabled.

Sources: [Codex account quota implementation](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs), [Kimi's usage collector](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/ui/shell/usage.py), [OpenRouter account credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits), [OpenRouter key allowances](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key). Anthropic endpoint/header were checked against the installed Claude CLI.

## Verification

- `pnpm typecheck` passes.
- Focused Vitest suite: 20 tests across collectors, commands/real Hono message routes, routing and existing thread behavior. Includes zero allowance/balance, malformed/changed schema, HTTP failures, safe error output, request coalescing, cache expiry, credential changes, partial OpenRouter failure, active API-key auth with stale ChatGPT token remnants and zero inference for command aliases. Message-route tests use an in-memory ledger, not SQL.
- `pnpm build` and `git diff --check` pass.
- DESIGN.md lint: zero errors, one documented existing-format warning (no YAML front matter).
- Real browser: reproduced the live Settings page's missing quota view; verified Settings link click to `/usages`, direct navigation, browser reload, all ten cards, local EDT/EST reset labels, Refresh, `/usages` chat rendering and draft preservation. Desktop 1440px and mobile 375px checks show no horizontal overflow; every provider is reachable by scrolling. Mobile navigation targets measured 50.5px.
- Actual terminal `node --disable-warning=ExperimentalWarning src/cli.ts ask /usages` succeeds and saves the concise report to `usages.txt`. This quota-only path exits before opening Memory.
- The requested app/web AGENTS.md guides are empty. No live restart, migration, login change, purchase, push or external PR. Initial worktree was clean; no owner edits were altered.

Screenshots: `before-settings.png`, `settings-usages-link.png`, `usages-from-settings.png`, `usages-direct-refresh.png`, `credits-mobile.png`, `credits-mobile-bottom.png`, `credits-balances.png`, `credits-providers.png`, `usages-chat.png`.

## Captain integration

Use the local T48 commit on branch `majordomo/runtimecredits` after reviewing the diff. Rebuild with `pnpm build` in the integrated checkout. A captain-authorized server restart is needed to load the new `/api/credits` and message-command handling; this worker did not restart the live service. Existing SPA static fallback already serves `/usages`; no database or schema changes are needed.

For a read-only review while Wednesday remains live on port 4788:

```sh
pnpm build
PORT=4798 node --disable-warning=ExperimentalWarning test/credits-preview.ts
```

Open `http://127.0.0.1:4798/#/settings`, click the usage link, or go directly to `http://127.0.0.1:4798/usages`. This preview proxies existing GET APIs and generates command replies only in browser memory; other writes are blocked. It does not open a database or start a tmux session. Preview port 4798 is stopped after verification.

In Docker, collectors only see credential folders mounted into the container. Add the relevant account roots as read-only mounts when previewing quota-only access (for example `~/.claude-work` to `/home/node/.claude-work`) and select the container path in Settings. Existing inference CLIs may need writable mounts for their own normal login/session handling; the quota collectors themselves never write them. No container/system configuration was changed in this task.
