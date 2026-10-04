import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface Config {
  /** The assistant's display name, shown in the UI, prompts and agent briefs. */
  name: string
  dataDir: string
  dbPath: string
  /** Claude CLI binary. */
  claudeBin: string
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
}

const env = process.env

function num(name: string, fallback: number): number {
  const v = env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`)
  return n
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(env.JARVIS_DATA_DIR || join(homedir(), '.jarvis'))
  const base: Config = {
    name: (env.ASSISTANT_NAME || 'Jarvis').trim() || 'Jarvis',
    dataDir,
    dbPath: join(dataDir, 'memory.db'),
    claudeBin: env.JARVIS_CLAUDE_BIN || 'claude',
    model: env.JARVIS_MODEL || 'opus',
    rotateAt: num('JARVIS_ROTATE_AT', 0.4),
    maxTurns: num('JARVIS_MAX_TURNS', 40),
    allowedTools: (env.JARVIS_ALLOWED_TOOLS ?? 'Read,Glob,Grep,Bash(git status:*),Bash(git log:*),Bash(git diff:*)')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    recallFacts: num('JARVIS_RECALL_FACTS', 6),
    recallLedger: num('JARVIS_RECALL_LEDGER', 4),
    tailMessages: num('JARVIS_TAIL_MESSAGES', 12),
    tailChars: num('JARVIS_TAIL_CHARS', 12000),
    nowBudgetChars: num('JARVIS_NOW_BUDGET_CHARS', 8000),
    promptFile: env.JARVIS_PROMPT_FILE || resolve(import.meta.dirname, '../prompts/captain.md'),
    turnTimeout: num('JARVIS_TURN_TIMEOUT', 600),
    sleepAt: env.JARVIS_SLEEP_AT ?? '04:00',
    sleepModel: env.JARVIS_SLEEP_MODEL || 'haiku',
    sleepPromptFile: env.JARVIS_SLEEP_PROMPT_FILE || resolve(import.meta.dirname, '../prompts/sleep.md'),
  }
  const cfg = { ...base, ...overrides }
  if (overrides.dataDir && !overrides.dbPath) cfg.dbPath = join(cfg.dataDir, 'memory.db')
  if (cfg.sleepAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.sleepAt)) throw new Error(`JARVIS_SLEEP_AT must be HH:MM (24h) or empty, got "${cfg.sleepAt}"`)
  return cfg
}
