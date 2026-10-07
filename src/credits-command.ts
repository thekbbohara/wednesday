import type { CreditAccount } from './credits-types.ts'

/** Recognize the slash command, including invalid arguments, so it never spends an inference turn. */
export const isUsageCommand = (text: string): boolean => /^\/usages?(?:\s|$)/i.test(text.trim())
export const validUsageCommand = (text: string): boolean => /^\/usages?$/i.test(text.trim())

export function usageReport(accounts: CreditAccount[]): string {
  const timestamp = (s: string) => `${s.replace('T', ' ').replace(/\.\d+Z$/, '')} UTC`
  const lines = ['Runtime usage (provider-reported; UTC reset times; 60s cache):']
  for (const a of accounts) {
    const label = `${a.runtime} · ${a.account}`
    if (a.status === 'unavailable') {
      lines.push(`- ${label}: unavailable - ${a.reason ?? 'No account quota reported.'}`)
      continue
    }
    const windows = a.allowances.map(w => {
      const left = w.remainingPercent === undefined ? w.remaining : `${Number(w.remainingPercent.toFixed(2))}% left${w.remaining ? ` / ${w.remaining}` : ''}`
      return `${w.label}: ${left}; ${w.resetsAt ? `resets ${timestamp(w.resetsAt)}` : 'reset not reported'}`
    }).join(' | ')
    lines.push(`- ${label}: ${a.status === 'stale' ? `STALE (reported ${a.fetchedAt ? timestamp(a.fetchedAt) : 'unknown'}; ${a.reason}). ` : ''}${windows}`)
    if (a.note) lines.push(`  ${a.note}`)
  }
  const fetched = accounts.flatMap(a => a.fetchedAt ? [a.fetchedAt] : []).sort()
  const checked = accounts.map(a => a.checkedAt).sort()
  if (fetched.length) lines.push(`Reports: ${timestamp(fetched[0])}${fetched.at(-1) !== fetched[0] ? ` to ${timestamp(fetched.at(-1)!)}` : ''}.`)
  if (checked.length) lines.push(`Last check: ${timestamp(checked.at(-1)!)}. Credits page has sources and per-account freshness.`)
  return lines.join('\n')
}
