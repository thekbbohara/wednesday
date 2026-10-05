// Builds the Runner for a captain provider: a Claude account (its own config
// dir) or Codex. Shared by the server, the terminal CLI and the eval.
import type { Config } from '../config.ts'
import { ClaudeRunner, type Runner } from './runner.ts'
import { KimiRunner } from './kimi.ts'
import { CodexRunner } from './codex.ts'
import type { Provider } from './provider.ts'

export function buildRunner(p: Provider, cfg: Config): Runner {
  if (p.kind === 'kimi') return new KimiRunner({ model: p.model, dataDir: cfg.dataDir, timeoutSec: cfg.turnTimeout })
  if (p.kind === 'codex') {
    return new CodexRunner({ bin: 'codex', model: p.model, cwd: cfg.dataDir, dataDir: cfg.dataDir, timeoutSec: cfg.turnTimeout })
  }
  return new ClaudeRunner({
    bin: cfg.claudeBin,
    model: p.model ?? (() => cfg.model),
    cwd: cfg.dataDir,
    allowedTools: () => cfg.allowedTools,
    timeoutSec: cfg.turnTimeout,
    ...(p.configDir ? { env: { CLAUDE_CONFIG_DIR: p.configDir } } : {}),
  })
}
