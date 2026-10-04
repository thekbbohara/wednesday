// The captain's provider chain: the primary Claude login first, then fallbacks
// tried in order when one hits its usage limit.
//   JARVIS_FALLBACKS=claude:~/.claude-2,claude:~/.claude-3,codex
// A `claude:<dir>` entry is another Claude account (its own CLAUDE_CONFIG_DIR);
// `codex` or `codex:<model>` is the Codex CLI.
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

export interface Provider {
  id: string
  kind: 'claude' | 'codex'
  label: string
  /** Claude: the account's config dir (unset = the default login). */
  configDir?: string
  /** Codex: model override. */
  model?: string
}

const expand = (p: string) => resolve(p.trim().replace(/^~(?=$|\/)/, homedir()))

export function parseChain(fallbacks: string | undefined, primaryConfigDir?: string): Provider[] {
  const chain: Provider[] = [{ id: 'claude', kind: 'claude', label: 'Claude', ...(primaryConfigDir ? { configDir: expand(primaryConfigDir) } : {}) }]
  for (const raw of (fallbacks ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [kind, ...rest] = raw.split(':')
    const arg = rest.join(':').trim()
    if (kind === 'claude') {
      if (!arg) throw new Error(`JARVIS_FALLBACKS: "${raw}" needs a config dir, e.g. claude:~/.claude-2`)
      const dir = expand(arg)
      chain.push({ id: `claude@${basename(dir)}`, kind: 'claude', label: `Claude (${basename(dir).replace(/^\./, '')})`, configDir: dir })
    } else if (kind === 'codex') {
      chain.push({ id: arg ? `codex:${arg}` : 'codex', kind: 'codex', label: arg ? `Codex (${arg})` : 'Codex', ...(arg ? { model: arg } : {}) })
    } else {
      throw new Error(`JARVIS_FALLBACKS: unknown entry "${raw}" (use claude:<config dir> or codex[:model])`)
    }
  }
  const seen = new Set<string>()
  return chain.filter((p) => !seen.has(p.id) && seen.add(p.id))
}

/** A plan/usage cap or rate limit: worth switching provider. Transient overload is not. */
export function isUsageLimit(text: string): boolean {
  return /usage limit|rate.?limit|too many requests|\b429\b|quota|limit reached|limit will reset|exceeded your|insufficient_quota|out of credits/i.test(text)
}
