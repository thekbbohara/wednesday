// The captain's configured provider chain: default Claude login, then fallbacks
// tried in order when one hits its usage limit.
//   MAJORDOMO_FALLBACKS=claude:~/.claude-2,claude:~/.claude-3,codex
// A `claude:<dir>` entry is another Claude account (its own CLAUDE_CONFIG_DIR);
// `codex[:model]` and `kimi[:model]` select their respective CLIs.
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

export type Engine = 'claude' | 'codex' | 'kimi'
export const ENGINES: Engine[] = ['claude', 'codex', 'kimi']

export interface Provider {
  id: string
  kind: Engine
  label: string
  /** Claude: the account's config dir (unset = the default login). */
  configDir?: string
  /** Provider-specific model override. */
  model?: string
}

const expand = (p: string) => resolve(p.trim().replace(/^~(?=$|\/)/, homedir()))

export function parseChain(fallbacks: string | undefined, primaryConfigDir?: string): Provider[] {
  const chain: Provider[] = [{ id: 'claude', kind: 'claude', label: 'Claude', ...(primaryConfigDir ? { configDir: expand(primaryConfigDir) } : {}) }]
  for (const raw of (fallbacks ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [kind, ...rest] = raw.split(':')
    const arg = rest.join(':').trim()
    if (kind === 'claude') {
      if (!arg) throw new Error(`MAJORDOMO_FALLBACKS: "${raw}" needs a config dir, e.g. claude:~/.claude-2`)
      const dir = expand(arg)
      chain.push({ id: `claude@${basename(dir)}`, kind: 'claude', label: `Claude (${basename(dir).replace(/^\./, '')})`, configDir: dir })
    } else if (kind === 'codex' || kind === 'kimi') {
      chain.push({ id: arg ? `${kind}:${arg}` : kind, kind, label: arg ? `${kind} (${arg})` : kind, ...(arg ? { model: arg } : {}) })
    } else {
      throw new Error(`MAJORDOMO_FALLBACKS: unknown entry "${raw}" (use claude:<config dir> or codex[:model] or kimi[:model])`)
    }
  }
  const seen = new Set<string>()
  return chain.filter((p) => !seen.has(p.id) && seen.add(p.id))
}

/** A plan/usage cap or rate limit: worth switching provider. Transient overload is not. */
export function isUsageLimit(text: string): boolean {
  return /usage limit|rate.?limit|too many requests|\b429\b|quota|limit reached|limit will reset|exceeded your|insufficient_quota|out of credits/i.test(text)
}

/** Selected engine first, followed by configured fallbacks. */
export function selectedChain(chain: Provider[], engine: Engine, model = ''): Provider[] {
  const base = chain.find((p) => p.kind === engine) ?? { id: engine, kind: engine, label: engine }
  const primary = { ...base, id: model ? `${engine}:${model}` : base.id, ...(model ? { model } : {}) }
  return [primary, ...chain.filter((p) => p.id !== primary.id && p.id !== base.id)]
}
