// Which Claude account (CLAUDE_CONFIG_DIR) every Claude launch uses: the
// captain's primary engine, the nightly sleep and claude-code workers.
// Empty means Claude's own default login (~/.claude).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** "~/x" -> "/home/me/x". Relative paths are not accepted by the setting, so callers check first. */
export function expandHome(p: string): string {
  const t = p.trim()
  return t ? resolve(t.replace(/^~(?=$|\/)/, homedir())) : ''
}

/** "/home/me/x" -> "~/x", for display and settings.json. */
export function contractHome(p: string): string {
  const home = homedir()
  return p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p
}

/** Why a config dir value is unusable, or null when it is fine. */
export function configDirError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Use a folder path, or empty for the default login.'
  const t = value.trim()
  if (!t) return null
  if (!isAbsolute(t) && !/^~(?=$|\/)/.test(t)) return 'Use an absolute path or one starting with ~/.'
  const dir = expandHome(t)
  try {
    if (!statSync(dir).isDirectory()) return `${t} is not a folder.`
  } catch {
    return `${t} does not exist. Log in once with CLAUDE_CONFIG_DIR=${t} claude.`
  }
  return null
}

/**
 * The environment for a Claude launch: CLAUDE_CONFIG_DIR set to `dir`, or
 * removed when `dir` is empty, so an inherited value never picks the account.
 */
export function claudeEnv(dir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  if (dir) env.CLAUDE_CONFIG_DIR = dir
  else delete env.CLAUDE_CONFIG_DIR
  return env
}

export interface ClaudeAccount {
  /** The folder in use, "~"-contracted. */
  dir: string
  exists: boolean
  /** A credentials file is present (its contents are never read). */
  loggedIn: boolean
  /** From the account's .claude.json, when Claude recorded it. */
  email: string | null
}

/** What can be told cheaply about the account in `dir` (empty = default login). */
export function claudeAccount(dir: string): ClaudeAccount {
  const folder = dir || join(homedir(), '.claude')
  // With CLAUDE_CONFIG_DIR set, Claude keeps .claude.json inside it; by default it sits in the home folder.
  const global = dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
  let email: string | null = null
  try {
    const d = JSON.parse(readFileSync(global, 'utf8')) as { oauthAccount?: { emailAddress?: unknown } }
    if (typeof d.oauthAccount?.emailAddress === 'string') email = d.oauthAccount.emailAddress
  } catch {
    // no record yet
  }
  return { dir: contractHome(folder), exists: existsSync(folder), loggedIn: existsSync(join(folder, '.credentials.json')), email }
}
