import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseChain, type Engine, type Provider } from './captain/provider.ts'

export interface Config {
  /** The assistant's display name, shown in the UI, prompts and agent briefs. */
  name: string
  dataDir: string
  dbPath: string
  /** Claude CLI binary. */
  claudeBin: string
  engine: Engine
  engineModel: string
  model: string
  /** Rotate once the session's context passes this fraction of its window. */
  rotateAt: number
  /** Hard cap on turns per captain session, a backstop for the token trigger. */
  maxTurns: number
  /** Built-in tools the captain may use besides its memory tools (live checks only). */
  allowedTools: string[]
  /** Facts and ledger hits recalled per owner message. */
  recallFacts: number
  recallLedger: number
  /** Recent conversation carried into a fresh session. */
  tailMessages: number
  tailChars: number
  nowBudgetChars: number
  promptFile: string
  /** Seconds before a captain turn is abandoned. */
  turnTimeout: number
  /** Local time of the nightly sleep, "HH:MM"; empty disables the schedule. */
  sleepAt: string
  sleepModel: string
  sleepPromptFile: string
  /** Primary Claude login first, then fallbacks tried in order on a usage limit. */
  captainChain: Provider[]
  /** How long a provider that hit its limit is skipped before it is tried again. */
  limitCooldownMs: number
}

const env = process.env

function num(name: string, fallback: number): number {
  const v = env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`)
  return n
}

/** ~/.majordomo, or ~/.jarvis when only that exists (installs from before the rename keep their memory). */
function defaultDataDir(): string {
  const dir = join(homedir(), '.majordomo')
  const legacy = join(homedir(), '.jarvis')
  return !existsSync(dir) && existsSync(legacy) ? legacy : dir
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(env.MAJORDOMO_DATA_DIR || defaultDataDir())
  const base: Config = {
    name: (env.ASSISTANT_NAME || 'Majordomo').trim() || 'Majordomo',
    dataDir,
    dbPath: join(dataDir, 'memory.db'),
    claudeBin: env.MAJORDOMO_CLAUDE_BIN || 'claude',
    engine: 'claude',
    engineModel: '',
    model: env.MAJORDOMO_MODEL || 'opus',
    rotateAt: num('MAJORDOMO_ROTATE_AT', 0.4),
    maxTurns: num('MAJORDOMO_MAX_TURNS', 40),
    allowedTools: (env.MAJORDOMO_ALLOWED_TOOLS ?? 'Read,Glob,Grep,Bash(git status:*),Bash(git log:*),Bash(git diff:*)')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    recallFacts: num('MAJORDOMO_RECALL_FACTS', 6),
    recallLedger: num('MAJORDOMO_RECALL_LEDGER', 4),
    tailMessages: num('MAJORDOMO_TAIL_MESSAGES', 12),
    tailChars: num('MAJORDOMO_TAIL_CHARS', 12000),
    nowBudgetChars: num('MAJORDOMO_NOW_BUDGET_CHARS', 8000),
    promptFile: env.MAJORDOMO_PROMPT_FILE || resolve(import.meta.dirname, '../prompts/captain.md'),
    turnTimeout: num('MAJORDOMO_TURN_TIMEOUT', 600),
    sleepAt: env.MAJORDOMO_SLEEP_AT ?? '04:00',
    sleepModel: env.MAJORDOMO_SLEEP_MODEL || 'haiku',
    sleepPromptFile: env.MAJORDOMO_SLEEP_PROMPT_FILE || resolve(import.meta.dirname, '../prompts/sleep.md'),
    captainChain: parseChain(env.MAJORDOMO_FALLBACKS, env.CLAUDE_CONFIG_DIR),
    limitCooldownMs: num('MAJORDOMO_LIMIT_COOLDOWN_MIN', 180) * 60_000,
  }
  const cfg = { ...base, ...overrides }
  if (overrides.dataDir && !overrides.dbPath) cfg.dbPath = join(cfg.dataDir, 'memory.db')
  if (cfg.sleepAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.sleepAt)) throw new Error(`MAJORDOMO_SLEEP_AT must be HH:MM (24h) or empty, got "${cfg.sleepAt}"`)
  return cfg
}
