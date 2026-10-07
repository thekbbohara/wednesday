import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseChain, type Engine, type Provider } from './captain/provider.ts'
import { assistantEnv } from './env.ts'
import { expandHome } from './claude-account.ts'

export interface Config {
  /** The assistant's display name, shown in the UI, prompts and agent briefs. */
  name: string
  dataDir: string
  dbPath: string
  /** Claude CLI binary. */
  claudeBin: string
  /** CLAUDE_CONFIG_DIR for every Claude launch (captain, sleep, workers), absolute; empty = the default login. */
  claudeConfigDir: string
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
  /** Primary Claude login first, then fallbacks tried in order on a usage limit. The primary's account is `claudeConfigDir`, applied per turn (see primaryChain). */
  captainChain: Provider[]
  /** How long a provider that hit its limit is skipped before it is tried again. */
  limitCooldownMs: number
}

const env = process.env

function num(name: string, fallback: number): number {
  const v = assistantEnv(name)
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`WEDNESDAY_${name} must be a number, got "${v}"`)
  return n
}

/** Keep existing memory directories in their historical precedence. Never move data. */
export function defaultDataDir(home = homedir()): string {
  for (const name of ['.majordomo', '.jarvis', '.wednesday']) {
    const dir = join(home, name)
    if (existsSync(dir)) return dir
  }
  return join(home, '.wednesday')
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(assistantEnv('DATA_DIR') || defaultDataDir())
  const base: Config = {
    name: (env.ASSISTANT_NAME || 'Wednesday').trim() || 'Wednesday',
    dataDir,
    dbPath: join(dataDir, 'memory.db'),
    claudeBin: assistantEnv('CLAUDE_BIN') || 'claude',
    claudeConfigDir: expandHome(env.CLAUDE_CONFIG_DIR ?? ''),
    engine: 'claude',
    engineModel: '',
    model: assistantEnv('MODEL') || 'opus',
    rotateAt: num('ROTATE_AT', 0.4),
    maxTurns: num('MAX_TURNS', 40),
    allowedTools: (assistantEnv('ALLOWED_TOOLS') ?? 'Read,Glob,Grep,Bash(git status:*),Bash(git log:*),Bash(git diff:*)')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    recallFacts: num('RECALL_FACTS', 6),
    recallLedger: num('RECALL_LEDGER', 4),
    tailMessages: num('TAIL_MESSAGES', 12),
    tailChars: num('TAIL_CHARS', 12000),
    nowBudgetChars: num('NOW_BUDGET_CHARS', 8000),
    promptFile: assistantEnv('PROMPT_FILE') || resolve(import.meta.dirname, '../prompts/captain.md'),
    turnTimeout: num('TURN_TIMEOUT', 600),
    sleepAt: assistantEnv('SLEEP_AT') ?? '04:00',
    sleepModel: assistantEnv('SLEEP_MODEL') || 'haiku',
    sleepPromptFile: assistantEnv('SLEEP_PROMPT_FILE') || resolve(import.meta.dirname, '../prompts/sleep.md'),
    captainChain: parseChain(assistantEnv('FALLBACKS')),
    limitCooldownMs: num('LIMIT_COOLDOWN_MIN', 180) * 60_000,
  }
  const cfg = { ...base, ...overrides }
  if (overrides.dataDir && !overrides.dbPath) cfg.dbPath = join(cfg.dataDir, 'memory.db')
  if (cfg.sleepAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.sleepAt)) throw new Error(`WEDNESDAY_SLEEP_AT must be HH:MM (24h) or empty, got "${cfg.sleepAt}"`)
  return cfg
}
