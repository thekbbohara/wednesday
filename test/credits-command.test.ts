import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isUsageCommand, validUsageCommand, usageReport } from '../src/credits-command.ts'
import type { CreditAccount } from '../src/credits-types.ts'
import { createApp } from '../src/server.ts'
import { loadConfig } from '../src/config.ts'
import type { LedgerEntry, Memory } from '../src/memory/store.ts'

const account: CreditAccount = { id: 'claude-work', runtime: 'Claude Code', account: '~/.claude-work', source: 'Anthropic OAuth usage', status: 'available', checkedAt: '2026-10-07T18:00:00.000Z', fetchedAt: '2026-10-07T18:00:00.000Z', reason: null, allowances: [{ label: '5-hour allowance', remainingPercent: 0, resetsAt: '2026-10-07T21:00:00.000Z' }] }

describe('usage slash commands', () => {
  it('recognizes both aliases and rejects arguments without matching ordinary messages', () => {
    for (const text of ['/usages', ' /usage ', '/USAGES']) expect(validUsageCommand(text)).toBe(true)
    expect(isUsageCommand('/usage detail')).toBe(true)
    expect(validUsageCommand('/usage detail')).toBe(false)
    expect(isUsageCommand('/usagefoo')).toBe(false)
    expect(isUsageCommand('show usage')).toBe(false)
  })
  it('prints actual quota, UTC reset, attribution, timestamp and stale or unavailable reasons', () => {
    const report = usageReport([account, { ...account, id: 'stale', status: 'stale', reason: 'Provider returned HTTP 503.' }, { ...account, runtime: 'Kimi', status: 'unavailable', reason: 'No local token.', fetchedAt: null, allowances: [] }])
    expect(report).toContain('Claude Code · ~/.claude-work')
    expect(report).toContain('0% left; resets 2026-10-07 21:00:00 UTC')
    expect(report).toContain('STALE (reported 2026-10-07 18:00:00 UTC; Provider returned HTTP 503.')
    expect(report).toContain('unavailable - No local token.')
    expect(report).toContain('Last check: 2026-10-07 18:00:00 UTC')
  })
  it('handles real message routes for both aliases without invoking inference or SQL', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'usage-route-'))
    const rows: LedgerEntry[] = []
    // An in-memory ledger avoids creating or migrating a database for this test.
    const mem = {
      append: (kind: LedgerEntry['kind'], text: string) => {
        const row = { id: rows.length + 1, kind, text, ts: '2026-10-07T18:00:00.000Z', session: null, meta: null } as LedgerEntry
        rows.push(row); return row
      },
      lastLedgerId: () => rows.at(-1)?.id ?? 0,
      ledgerSince: (id: number) => rows.filter(r => r.id > id),
      ledgerTail: () => rows.filter(r => r.kind === 'captain').slice(-1),
      expBySkill: () => new Map(), taskList: () => [],
    } as unknown as Memory
    const read = vi.fn().mockResolvedValue({ accounts: [account], cacheSeconds: 60 })
    const run = vi.fn()
    const { app, captain, close } = createApp({ mem, cfg: loadConfig({ dataDir }), runner: { run }, credits: { read }, token: 'test-auth' })
    const post = (text: string, authorized = true) => app.request('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer test-auth' } : {}) }, body: JSON.stringify({ text }) })
    try {
      expect((await post('/usages', false)).status).toBe(401)
      expect(read).not.toHaveBeenCalled()
      for (const command of ['/usages', '/usage']) {
        const response = await post(command)
        expect(response.status).toBe(200)
        const body = await response.json() as { item: { text: string }; reply: { text: string; type: string } }
        expect(body.item.text).toBe(command)
        expect(body.reply).toMatchObject({ type: 'captain', text: usageReport([account]) })
      }
      expect(read).toHaveBeenCalledTimes(2)
      expect(run).not.toHaveBeenCalled()
      expect(captain.busy).toBe(false)
      const invalid = await (await post('/usages detail')).json() as { reply: { text: string } }
      expect(invalid.reply.text).toBe('Usage: /usages (alias /usage).')
      expect(read).toHaveBeenCalledTimes(2)
      read.mockRejectedValue(new Error('private-credential-string'))
      const failure = await (await post('/usage')).json() as { reply: { text: string } }
      expect(failure.reply.text).toContain('local quota collection failed')
      expect(failure.reply.text).not.toContain('private-credential-string')
      expect(run).not.toHaveBeenCalled()
    } finally { close(); rmSync(dataDir, { recursive: true, force: true }) }
  })
})
