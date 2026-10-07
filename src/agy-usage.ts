// Antigravity CLI 1.3.1 answers these built-in commands without an agent turn.
// Keep prompts fixed: never accept owner text or execute a shell here.
import { execFile } from 'node:child_process'
import type { Allowance } from './credits-types.ts'

export type AgyCommand = 'usage' | 'credits'
export type AgyRead = (command: AgyCommand) => Promise<unknown>
export const readAgy: AgyRead = command => new Promise((resolve, reject) => {
  execFile('agy', ['--print', `/${command}`, '--output-format', 'json', '--print-timeout', '15s'],
    { timeout: 20_000, maxBuffer: 256 * 1024, env: { ...process.env, AGY_CLI_HIDE_ACCOUNT_INFO: '1' } },
    (error, stdout) => {
      if (error) return reject(new Error('No Antigravity CLI quota response. Check agy installation and existing login manually; no login was initiated.'))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('No structured Antigravity CLI quota response.')) }
    })
})

export function parseAgy(value: unknown, command: AgyCommand): Allowance[] {
  const d = value as any
  // Fail closed on an inference result, an error, or an older unsupported CLI.
  if (!d || d.status !== 'SUCCESS' || d.num_turns !== 0 || d.usage?.total_tokens !== 0 || d.command?.name !== command) return []
  const data = d.command.data
  if (command === 'credits') {
    const n = data?.remaining_credits
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
      ? [{ label: 'AI credits', remaining: `${n} credits`, resetsAt: null }] : []
  }
  if (!Array.isArray(data?.groups)) return []
  const out: Allowance[] = []
  for (const group of data.groups) {
    if (typeof group?.name !== 'string' || !Array.isArray(group.buckets)) continue
    for (const bucket of group.buckets) {
      const fraction = bucket?.remaining_fraction
      if (typeof bucket?.name !== 'string' || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue
      const reset = typeof bucket.reset_time === 'string' ? new Date(bucket.reset_time) : null
      out.push({ label: `${group.name} · ${bucket.name}`, remainingPercent: Math.round(fraction * 10000) / 100,
        resetsAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null })
    }
  }
  return out
}
