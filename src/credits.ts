// Read-only quota collectors. Never refresh credentials or start an inference turn.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Config } from './config.ts'
import { contractHome } from './claude-account.ts'
import { loadRuntimes } from './agents/runtimes.ts'

import type { Allowance, CreditAccount } from './credits-types.ts'
type Obj = Record<string, any>
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const percent = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? 100 - v : undefined
const date = (v: unknown): string | null => {
  const d = typeof v === 'number' ? new Date(v * 1000) : typeof v === 'string' ? new Date(v) : null
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null
}
export function parseClaude(d: Obj): Allowance[] {
  const out: Allowance[] = []
  for (const [key, value] of Object.entries(d)) {
    if (!object(value)) continue
    const remainingPercent = percent(value.utilization)
    if (remainingPercent === undefined || key === 'extra_usage') continue
    out.push({ label: ({ five_hour: '5-hour allowance', seven_day: 'Weekly allowance', seven_day_sonnet: 'Weekly Sonnet', seven_day_opus: 'Weekly Opus' } as Record<string, string>)[key] ?? `Provider allowance · ${key}`, remainingPercent, resetsAt: date(value.resets_at),
      ...(typeof value.remaining_dollars === 'number' && Number.isFinite(value.remaining_dollars) ? { remaining: `${value.remaining_dollars} USD (reported)` } : {}) })
  }
  return out
}
export function parseCodex(d: Obj): Allowance[] {
  const out: Allowance[] = []
  const groups: [string, unknown][] = [['Account', d.rate_limit], ['Code review', d.code_review_rate_limit]]
  if (Array.isArray(d.additional_rate_limits)) for (const x of d.additional_rate_limits) if (object(x)) groups.push([String(x.limit_name ?? 'Additional allowance'), x.rate_limit])
  for (const [group, limits] of groups) {
    if (!object(limits)) continue
    for (const key of ['primary_window', 'secondary_window']) {
      const w = limits[key]; if (!object(w)) continue
      const remainingPercent = percent(w.used_percent); if (remainingPercent === undefined) continue
      const duration = typeof w.limit_window_seconds === 'number' ? `${w.limit_window_seconds % 86400 === 0 ? `${w.limit_window_seconds / 86400} days` : `${w.limit_window_seconds / 3600}h`}` : key.replace('_window', '')
      out.push({ label: `${group} · ${duration}`, remainingPercent, resetsAt: date(w.reset_at) })
    }
  }
  if (object(d.credits)) {
    const c = d.credits
    if (c.unlimited === true) out.push({ label: 'Credits', remaining: 'Unlimited (reported)', resetsAt: null })
    else if ((typeof c.balance === 'string' && /^\d+(\.\d+)?$/.test(c.balance)) || (typeof c.balance === 'number' && Number.isFinite(c.balance))) out.push({ label: 'Credits', remaining: `${c.balance} credits`, resetsAt: null })
  }
  const m = d.spend_control?.individual_limit
  if (object(m)) {
    const remainingPercent = percent(m.used_percent)
    if (remainingPercent !== undefined) out.push({ label: 'Individual spending allowance', remainingPercent, resetsAt: date(m.reset_at) })
  }
  return out
}
export function parseKimi(d: Obj): Allowance[] {
  const out: Allowance[] = []
  const row = (v: unknown, label: string) => {
    if (!object(v)) return
    const limit = typeof v.limit === 'string' && /^\d+(\.\d+)?$/.test(v.limit) ? Number(v.limit) : v.limit
    const remaining = typeof v.remaining === 'string' && /^\d+(\.\d+)?$/.test(v.remaining) ? Number(v.remaining) : v.remaining
    const used = typeof v.used === 'string' && /^\d+(\.\d+)?$/.test(v.used) ? Number(v.used) : v.used
    const left = typeof remaining === 'number' ? remaining : typeof limit === 'number' && typeof used === 'number' ? limit - used : undefined
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0 || typeof left !== 'number' || !Number.isFinite(left) || left < 0 || left > limit) return
    out.push({ label: typeof v.name === 'string' ? v.name : label, remainingPercent: Math.round(left / limit * 10000) / 100, remaining: `${left} / ${limit} allowance units`, resetsAt: date(v.reset_at ?? v.resetAt ?? v.reset_time ?? v.resetTime) })
  }
  row(d.usage, 'Weekly allowance')
  if (Array.isArray(d.limits)) d.limits.forEach((v, i) => {
    if (!object(v)) return
    const w = v.window
    const label = object(w) && typeof w.duration === 'number' && typeof w.timeUnit === 'string' ? `${w.duration} ${w.timeUnit.toLowerCase()} window` : `Allowance ${i + 1}`
    row(v.detail ?? v, typeof v.name === 'string' ? v.name : label)
  })
  return out
}
export function parseOpenRouter(credits: Obj, key: Obj = {}): Allowance[] {
  const out: Allowance[] = []
  const c = credits.data
  if (object(c) && typeof c.total_credits === 'number' && Number.isFinite(c.total_credits) && typeof c.total_usage === 'number' && Number.isFinite(c.total_usage)) {
    out.push({ label: 'Account credit balance', remaining: `${Number((c.total_credits - c.total_usage).toFixed(6))} USD`, resetsAt: null })
  }
  const k = key.data
  if (object(k)) {
    if (typeof k.limit_remaining === 'number' && Number.isFinite(k.limit_remaining)) out.push({ label: 'Per-key spending allowance', remaining: `${k.limit_remaining} USD`, resetsAt: null })
    else if (k.limit === null) out.push({ label: 'Per-key spending cap', remaining: 'No cap reported', resetsAt: null })
  }
  return out
}
interface Target { id: string; runtime: string; folder: string; file?: string; kind?: 'claude' | 'codex' | 'kimi' | 'openrouter'; endpoint?: string; piKey?: string; reason?: string }
export class Credits {
  private cache = new Map<string, { result: CreditAccount; expires: number; signature: string; pending?: Promise<CreditAccount> }>()
  private request: typeof fetch
  private home: string
  private now: () => number
  constructor(request: typeof fetch = fetch, home = homedir(), now = () => Date.now()) {
    this.request = request; this.home = home; this.now = now
  }
  async read(cfg: Config): Promise<{ accounts: CreditAccount[]; cacheSeconds: number }> {
    const targets: Target[] = []
    const dirs = new Set([join(this.home, '.claude'), cfg.claudeConfigDir || join(this.home, '.claude'), ...cfg.captainChain.filter(p => p.kind === 'claude' && p.configDir).map(p => p.configDir!)])
    if (existsSync(join(this.home, '.claude-work'))) dirs.add(join(this.home, '.claude-work'))
    for (const folder of dirs) targets.push({ id: `claude:${folder}`, runtime: 'Claude Code', folder, file: join(folder, '.credentials.json'), kind: 'claude' })
    targets.push({ id: 'codex', runtime: 'Codex', folder: process.env.CODEX_HOME || join(this.home, '.codex'), file: join(process.env.CODEX_HOME || join(this.home, '.codex'), 'auth.json'), kind: 'codex' })
    const piFolder = process.env.PI_CODING_AGENT_DIR || join(this.home, '.pi/agent')
    let pi: Obj = {}; try { const d: unknown = JSON.parse(readFileSync(join(piFolder, 'auth.json'), 'utf8')); if (object(d)) pi = d } catch { /* no auth */ }
    for (const key of Object.keys(pi)) targets.push({ id: `pi:${key}`, runtime: `pi / ${key}`, folder: piFolder, file: join(piFolder, 'auth.json'), piKey: key,
      ...(key === 'anthropic' ? { kind: 'claude' as const } : key === 'openai-codex' ? { kind: 'codex' as const } : key === 'openrouter' ? { kind: 'openrouter' as const } : { reason: 'No supported read-only account quota endpoint for this provider.' }) })
    const openCodeFolder = join(process.env.XDG_DATA_HOME || join(this.home, '.local/share'), 'opencode')
    let openCode: Obj = {}
    try { const d: unknown = JSON.parse(readFileSync(join(openCodeFolder, 'auth.json'), 'utf8')); if (object(d)) openCode = d } catch { /* unavailable */ }
    for (const key of Object.keys(openCode)) targets.push({ id: `opencode:${key}`, runtime: `OpenCode / ${key}`, folder: openCodeFolder, file: join(openCodeFolder, 'auth.json'), piKey: key,
      ...(key === 'anthropic' ? { kind: 'claude' as const } : key === 'openai' ? { kind: 'codex' as const } : key === 'openrouter' ? { kind: 'openrouter' as const } : { reason: 'No supported read-only account quota endpoint for this provider.' }) })
    const kimiFolder = process.env.KIMI_CODE_HOME || join(this.home, '.kimi-code')
    let kimiEndpoint = 'https://api.kimi.com/coding/v1/usages'
    try {
      const config = readFileSync(join(kimiFolder, 'config.toml'), 'utf8')
      // Only trusted first-party hosts. Never send credentials to arbitrary configured URLs.
      if (/base_url\s*=\s*["']https:\/\/api\.kimi\.ai\/coding\/v1["']/.test(config)) kimiEndpoint = 'https://api.kimi.ai/coding/v1/usages'
    } catch { /* default first-party platform */ }
    let kimiFiles: string[] = []
    try { kimiFiles = readdirSync(join(kimiFolder, 'credentials')).filter(n => /^kimi-code[^/]*\.json$/.test(n)) } catch { /* unavailable */ }
    for (const name of kimiFiles) targets.push({ id: `kimi:${name}`, runtime: 'Kimi', folder: join(kimiFolder, 'credentials', name), file: join(kimiFolder, 'credentials', name), kind: 'kimi', endpoint: kimiEndpoint })
    let runtimes
    try { runtimes = loadRuntimes(cfg.dataDir) } catch { runtimes = [{ id: 'runtime-config', label: 'Runtime configuration' }] }
    for (const r of runtimes) {
      if ('command' in r && typeof r.command === 'string' && ['claude-code', 'codex', 'pi', 'kimi', 'opencode'].includes(r.id)) {
        const binary = r.id === 'claude-code' ? 'claude' : r.id
        // Do not execute or guess account routing hidden in owner-supplied shell commands.
        if (!r.command.trim().startsWith(`${binary} `) && r.command.trim() !== binary || /(?:^|\s)(?:--profile|-p|--config-file|--config-dir)(?:\s|=)/.test(r.command)) {
          targets.push({ id: `routing:${r.id}`, runtime: `${r.label} account routing`, folder: 'Custom launch command', reason: 'This custom launch command may select another account. Account routing is unavailable; the credential-store quotas listed here are independent.' })
        }
      }
      if (['claude-code', 'codex'].includes(r.id) || (r.id === 'pi' && Object.keys(pi).length) || (r.id === 'kimi' && kimiFiles.length) || (r.id === 'opencode' && Object.keys(openCode).length)) continue
      targets.push({ id: r.id, runtime: r.label, folder: r.id === 'kimi' ? process.env.KIMI_CODE_HOME || join(this.home, '.kimi-code') : r.id === 'opencode' ? openCodeFolder : 'Configured runtime', reason: r.id === 'runtime-config' ? 'Local runtime configuration is unreadable or malformed. Other configured runtime accounts cannot be enumerated.' : r.id === 'opencode' ? 'No readable provider entries in OpenCode auth.json. No account quota can be attributed from this local source.' : r.id === 'kimi' ? 'No readable OAuth credentials file. Keyring access and login changes are not performed.' : 'This runtime has no supported account quota collector. Context and token counts are not account credit.' })
    }
    return { accounts: await Promise.all(targets.map(t => this.collect(t))), cacheSeconds: 60 }
  }
  private collect(t: Target): Promise<CreditAccount> {
    let signature = `${t.kind}:${t.endpoint}:${t.file}:${t.piKey}:${t.reason}`
    try { const stat = statSync(t.file!); signature += `:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` } catch { signature += ':missing' }
    let old = this.cache.get(t.id)
    if (old && old.signature !== signature) { this.cache.delete(t.id); old = undefined }
    if (old?.pending) return old.pending
    if (old && old.expires > this.now()) return Promise.resolve(old.result)
    const pending = this.fetchTarget(t, old?.result).then(result => {
      // A credential change may have started a newer request while this one ran.
      if (this.cache.get(t.id)?.pending === pending) this.cache.set(t.id, { result, signature, expires: this.now() + 60_000 })
      return result
    })
    if (old) old.pending = pending
    else this.cache.set(t.id, { result: {} as CreditAccount, expires: 0, signature, pending })
    return pending
  }
  private async fetchTarget(t: Target, previous?: CreditAccount): Promise<CreditAccount> {
    const checkedAt = new Date(this.now()).toISOString()
    const base: CreditAccount = { id: t.id, runtime: t.runtime, account: contractHome(t.folder), source: t.kind === 'claude' ? 'Anthropic OAuth usage' : t.kind === 'codex' ? 'ChatGPT WHAM usage' : t.kind === 'kimi' ? 'Kimi Code usages' : t.kind === 'openrouter' ? 'OpenRouter account credits and key cap' : 'Local configuration', status: 'unavailable', checkedAt, fetchedAt: null, reason: null, allowances: [] }
    try {
      if (t.reason) throw new Error(t.reason)
      let auth: Obj
      try { auth = JSON.parse(readFileSync(t.file!, 'utf8')); if (!object(auth)) throw new Error('Invalid credential shape') } catch { throw new Error('Local credentials are missing, unreadable, or malformed.') }
      if (t.kind === 'codex' && !t.piKey && ((typeof auth.auth_mode === 'string' && auth.auth_mode !== 'chatgpt') || typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0)) throw new Error('No subscription quota for the active Codex API-key or unsupported auth mode. Stored ChatGPT token remnants are not queried.')
      const a = t.piKey ? auth[t.piKey] : t.kind === 'claude' ? auth.claudeAiOauth : t.kind === 'kimi' ? auth : auth.tokens
      const token = t.piKey ? (t.kind === 'openrouter' ? a?.access ?? a?.key : a?.access) : t.kind === 'claude' ? a?.accessToken : a?.access_token
      if (typeof token !== 'string' || !token) throw new Error(t.kind === 'kimi' ? 'No OAuth access token in the local credential file (empty or unsupported). No login or refresh was attempted.' : 'No supported OAuth access token. API keys do not report subscription allowance here.')
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (t.kind === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20'
      else if (t.kind === 'codex') {
        const id = t.piKey ? a?.accountId : a?.account_id
        if (typeof id !== 'string' || !id) throw new Error('OAuth account attribution is missing.')
        headers['ChatGPT-Account-Id'] = id
        base.account += ` · ${id}`
      }
      if (t.kind === 'openrouter') {
        const results = await Promise.allSettled(['credits', 'key'].map(async path => {
          const r = await this.request(`https://openrouter.ai/api/v1/${path}`, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' })
          if (!r.ok) throw new Error(`Provider returned HTTP ${r.status} for ${path}.`)
          const d: unknown = await r.json()
          if (!object(d)) throw new Error('Provider returned an unsupported usage response.')
          return d
        }))
        const [creditResult, keyResult] = results
        const allowances = parseOpenRouter(creditResult.status === 'fulfilled' ? creditResult.value : {}, keyResult.status === 'fulfilled' ? keyResult.value : {})
        if (!allowances.length) throw new Error('Provider returned no readable credit balance or key allowance.')
        return { ...base, status: 'available', fetchedAt: new Date(this.now()).toISOString(), allowances,
          note: allowances.some(a => a.label === 'Account credit balance') ? 'Balance = provider-reported purchased credits minus provider-reported account usage. Key caps are separate.' : 'Account credit balance unavailable. The per-key cap does not report account funds.' }
      }
      const response = await this.request(t.kind === 'claude' ? 'https://api.anthropic.com/api/oauth/usage' : t.kind === 'kimi' ? t.endpoint! : 'https://chatgpt.com/backend-api/wham/usage', { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}${response.status === 401 || response.status === 403 ? '; local login may be expired or lack usage access' : ''}.`)
      const d: unknown = await response.json()
      if (!object(d)) throw new Error('Provider returned an unsupported usage response.')
      const allowances = t.kind === 'claude' ? parseClaude(d) : t.kind === 'kimi' ? parseKimi(d) : parseCodex(d)
      if (!allowances.length) throw new Error('Provider returned no recognized account allowance fields.')
      return { ...base, status: 'available', fetchedAt: new Date(this.now()).toISOString(), allowances, note: t.kind === 'claude' && object(d.extra_usage) ? `Extra usage: ${d.extra_usage.is_enabled === true ? 'enabled; spending cap is not a credit balance' : 'disabled'}.` : undefined }
    } catch (e) {
      // Never forward network exception text or provider bodies: they can contain credentials.
      const reason = e instanceof Error && (e.message.startsWith('Provider ') || e.message.startsWith('Local ') || e.message.startsWith('No ') || e.message.startsWith('OAuth ') || e.message.startsWith('This ')) ? e.message : 'Quota request failed or timed out. Credentials were not changed.'
      if (previous?.fetchedAt) return { ...previous, status: 'stale', checkedAt, reason }
      return { ...base, reason }
    }
  }
}
