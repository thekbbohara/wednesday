// The captain's configured provider chain: default Claude login, then fallbacks
// tried in order when one hits its usage limit.
//   MAJORDOMO_FALLBACKS=claude:~/.claude-2,claude:~/.claude-3,codex
// A `claude:<dir>` entry is another Claude account (its own CLAUDE_CONFIG_DIR);
// `codex[:model]` and `kimi[:model]` select their respective CLIs.
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { defaultEngineModel, type Engine } from '../engines.ts'
export { ENGINES, type Engine } from '../engines.ts'


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

/** The primary Claude login: the default one, or the account in `configDir`. */
export function claudePrimary(configDir?: string): Provider {
  if (!configDir) return { id: 'claude', kind: 'claude', label: 'Claude' }
  const dir = expand(configDir)
  return { id: `claude@${basename(dir)}`, kind: 'claude', label: `Claude (${basename(dir).replace(/^\./, '')})`, configDir: dir }
}

export function parseChain(fallbacks: string | undefined, primaryConfigDir?: string): Provider[] {
  const chain: Provider[] = [claudePrimary(primaryConfigDir)]
  for (const raw of (fallbacks ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [kind, ...rest] = raw.split(':')
    const arg = rest.join(':').trim()
    if (kind === 'claude') {
      if (!arg) throw new Error(`MAJORDOMO_FALLBACKS: "${raw}" needs a config dir, e.g. claude:~/.claude-2`)
      const dir = expand(arg)
      chain.push({ id: `claude@${basename(dir)}`, kind: 'claude', label: `Claude (${basename(dir).replace(/^\./, '')})`, configDir: dir })
    } else if (kind === 'codex' || kind === 'kimi' || kind === 'agy') {
      chain.push({ id: arg ? `${kind}:${arg}` : kind, kind, label: arg ? `${kind} (${arg})` : kind, ...(arg ? { model: arg } : {}) })
    } else {
      throw new Error(`MAJORDOMO_FALLBACKS: unknown entry "${raw}" (use claude:<config dir> or codex[:model], kimi[:model], agy[:model])`)
    }
  }
  return dedupe(chain)
}

function dedupe(chain: Provider[]): Provider[] {
  const seen = new Set<string>()
  return chain.filter((p) => !seen.has(p.id) && seen.add(p.id))
}

/**
 * The chain with its primary on the account currently set (the claudeConfigDir
 * setting), so a change applies at the next turn. Each account has its own id,
 * so its sessions, runner and usage-limit cooldown stay its own.
 */
export function primaryChain(chain: Provider[], configDir: string): Provider[] {
  return dedupe([claudePrimary(configDir), ...chain.slice(1)])
}

/** A plan/usage cap or rate limit: worth switching provider. Transient overload is not. */
export function isUsageLimit(text: string): boolean {
  return /usage limit|rate.?limit|too many requests|\b429\b|quota|limit reached|limit will reset|exceeded your|insufficient_quota|out of credits/i.test(text)
}

/** Selected engine first, followed by configured fallbacks. */
export function selectedChain(chain: Provider[], engine: Engine, model = ''): Provider[] {
  const base = chain.find((p) => p.kind === engine) ?? { id: engine, kind: engine, label: engine }
  model = model || base.model || defaultEngineModel(engine)
  // A Claude account keeps its own id under a model override: sessions do not carry across accounts.
  const primary = { ...base, id: model ? `${base.configDir ? base.id : engine}:${model}` : base.id, ...(model ? { model } : {}) }
  return [primary, ...chain.filter((p) => p.id !== primary.id && p.id !== base.id)]
}
