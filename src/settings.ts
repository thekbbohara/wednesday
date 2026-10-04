// Settings the owner changes from the UI. They are saved to <data>/settings.json,
// override the env defaults, and apply to the next turn without a restart.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from './config.ts'

export interface Settings {
  model: string
  /** WebSearch and WebFetch for the captain. */
  web: boolean
  rotateAt: number
  maxTurns: number
  /** "HH:MM", or "" for off. */
  sleepAt: string
  sleepModel: string
}

export const MODELS = ['opus', 'sonnet', 'haiku']
const WEB_TOOLS = ['WebSearch', 'WebFetch']
const MODEL = /^[a-z0-9][a-z0-9.\-[\]]{1,60}$/

export function currentSettings(cfg: Config): Settings {
  return {
    model: cfg.model,
    web: WEB_TOOLS.every((t) => cfg.allowedTools.includes(t)),
    rotateAt: cfg.rotateAt,
    maxTurns: cfg.maxTurns,
    sleepAt: cfg.sleepAt,
    sleepModel: cfg.sleepModel,
  }
}

/** Field -> reason, for every invalid value in the patch. */
export function check(patch: Partial<Settings>): Record<string, string> {
  const errors: Record<string, string> = {}
  if (patch.model !== undefined && !MODEL.test(String(patch.model))) errors.model = 'Use a model alias (opus, sonnet, haiku) or a full model id.'
  if (patch.sleepModel !== undefined && !MODEL.test(String(patch.sleepModel))) errors.sleepModel = 'Use a model alias (opus, sonnet, haiku) or a full model id.'
  if (patch.web !== undefined && typeof patch.web !== 'boolean') errors.web = 'On or off.'
  if (patch.rotateAt !== undefined && !(typeof patch.rotateAt === 'number' && patch.rotateAt >= 0.1 && patch.rotateAt <= 0.9))
    errors.rotateAt = 'Between 10% and 90% of the context window.'
  if (patch.maxTurns !== undefined && !(Number.isInteger(patch.maxTurns) && patch.maxTurns >= 5 && patch.maxTurns <= 500)) errors.maxTurns = 'A whole number from 5 to 500.'
  if (patch.sleepAt !== undefined && !(patch.sleepAt === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.sleepAt))))
    errors.sleepAt = 'A 24h time like 04:00, or off.'
  return errors
}

/** Applies a checked patch to the live config. */
export function apply(cfg: Config, patch: Partial<Settings>): void {
  if (patch.model !== undefined) cfg.model = patch.model
  if (patch.sleepModel !== undefined) cfg.sleepModel = patch.sleepModel
  if (patch.rotateAt !== undefined) cfg.rotateAt = patch.rotateAt
  if (patch.maxTurns !== undefined) cfg.maxTurns = patch.maxTurns
  if (patch.sleepAt !== undefined) cfg.sleepAt = patch.sleepAt
  if (patch.web !== undefined) {
    const rest = cfg.allowedTools.filter((t) => !WEB_TOOLS.includes(t))
    cfg.allowedTools = patch.web ? [...rest, ...WEB_TOOLS] : rest
  }
}

const file = (cfg: Config) => join(cfg.dataDir, 'settings.json')

/** At startup: settings saved from the UI win over env defaults. A broken file is reported, not fatal. */
export function loadSettings(cfg: Config, log = console.warn): void {
  if (!existsSync(file(cfg))) return
  try {
    const saved = JSON.parse(readFileSync(file(cfg), 'utf8')) as Partial<Settings>
    const errors = check(saved)
    for (const k of Object.keys(errors)) delete saved[k as keyof Settings]
    if (Object.keys(errors).length) log(`settings.json: ignoring ${Object.keys(errors).join(', ')}`)
    apply(cfg, saved)
  } catch (e) {
    log(`settings.json is not valid JSON, using defaults: ${(e as Error).message}`)
  }
}

export function saveSettings(cfg: Config): void {
  writeFileSync(file(cfg), `${JSON.stringify(currentSettings(cfg), null, 2)}\n`)
}
