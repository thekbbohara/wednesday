# T49 expanded: agy captain on Opus, workers on Gemini

Owner clarification L2450 requested a selectable agy captain engine, with Opus as its default, and Gemini as the default for new agy workers. The previously activated quota build stayed healthy with Codex selected throughout implementation and preview verification. This supersedes the quota-only scope in the earlier T49 reports.

## Models and behavior

Verified with installed Antigravity CLI 1.3.1 `agy models` and native read-only `/model` JSON:

- Captain default: `claude-opus-4-6-thinking`, displayed as Claude Opus 4.6 (Thinking).
- New agy worker command: `agy --model gemini-3.8-flash-medium`, displayed as Gemini 3.8 Flash (Medium).
- Explicit captain override: `/engine agy <model-id>`, Settings, API `POST /api/captain/engine` or MCP `captain_engine_set`.
- Explicit worker override: the existing `<data>/runtimes.json` command override, for example `[{"id":"agy","command":"agy --model claude-sonnet-4-6"}]`. Owner-supplied runtime commands remain authoritative.

Engine type validation, provider selection/fallback, chat `/engine`, terminal help, API, MCP schema, Settings and the composer picker accept agy. Selecting agy with no model sets the full Opus identifier; switching from another engine clears its model override. Settings exposes the verified Antigravity model choices and preserves an explicitly configured model id.

The AgyRunner generates a private per-memory-session agent definition with Wednesday's system instructions and explicit local memory/worker MCP servers. It excludes inherited customizations and default native tools; work is delegated through the worker MCP tools. No global configuration or credentials are copied or edited. Explicit CLI conversation ids are mapped to Majordomo memory sessions and resumed with `--conversation`, never the globally most-recent conversation. Missing/mismatched mappings fail rather than silently reusing another session. Structured failures are sanitized and usage caps retain provider failover behavior. Process and output bounds are enforced.

The CLI reports aggregate token usage, not a reliable context size/window or dollar cost. Agy therefore retains turn-cap rotation and does not invent context percentages or token-to-credit estimates. Its real account quotas are collected separately via native `/usage` and `/credits`.

## Zero-inference verification

`model-evidence.json` records both full model ids reported by native `/model`, with zero turns and zero tokens. The generated custom agent was discovered by native `/agents`. An interactive tool PTY, without any tmux creation, reached the workspace trust menu and then the custom agent input prompt displaying Claude Opus 4.6 (Thinking). Only native `/mcp` inspection was entered; no inference prompt was sent, and the process was exited. The CLI's global MCP manager also displayed an unrelated pre-existing Atlassian authentication error; no login or repair was attempted. The session-local probe MCP was not started before an inference turn, so this is not a claim of a real model-driven memory-tool call.

The native headless inference/resumption and model-driven MCP use cannot be fully exercised under the no-inference constraint. Their protocol is covered by an executable fake CLI and an in-memory MCP transport. The generated agent and MCP schema follow [Google's custom-agent documentation](https://www.antigravity.google/docs/subagents/) and [MCP documentation](https://www.antigravity.google/docs/mcp/); supported flags and JSON envelopes were verified on the installed CLI. No real agy inference turn was invoked for verification.

`pnpm typecheck` passed. The explicit focused Vitest selection passed 39 tests in seven files. The new tests cover defaults and overrides, engine type/model validation, real API and chat routes, real MCP registration/forwarding over an in-memory transport, Codex-to-agy switching after an active fake turn completes with fresh memory, generated agent/MCP isolation, exact conversation resumption, missing mappings and sanitized errors. They use plain objects, plain files and a fake CLI. No SQLite connection/schema initialization or tmux session is used by these selected tests.

The production build was first written outside the live `dist` to `/tmp/t49-agy-captain-dist`, keeping the running UI unchanged. The real browser exercised an isolated Settings preview on port 4799, saving only to in-memory configuration. It selected agy, showed the correct Opus default, and followed Settings to Usage. `agy-opus-settings-preview.png` is the preview screenshot. Live Settings still reported Codex during these checks. No server or original owner file was modified by the preview.

Activation and the owner-requested persisted next-turn switch are recorded in the separate activation evidence added after the code commit. A real inference call is intentionally left to the next normal owner/captain turn, rather than spending tokens on a smoke test.
