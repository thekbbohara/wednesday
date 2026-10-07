import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Credits, parseClaude, parseCodex, parseKimi, parseOpenRouter } from '../src/credits.ts'
import { loadConfig } from '../src/config.ts'

describe('reported account quotas', () => {
  it('keeps independent windows, zero balances and reset times without token estimates', () => {
    expect(parseClaude({ five_hour: { utilization: 100, resets_at: '2026-10-07T20:00:00Z' }, seven_day: { utilization: 38 }, extra_usage: { utilization: 0, monthly_limit: 4000 }, unknown: { utilization: '5' } })).toEqual([
      { label: '5-hour allowance', remainingPercent: 0, resetsAt: '2026-10-07T20:00:00.000Z' }, { label: 'Weekly allowance', remainingPercent: 62, resetsAt: null },
    ])
    expect(parseCodex({ rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 18000, reset_at: 0 } }, credits: { balance: '0' }, contextTokens: 10 })).toEqual([
      { label: 'Account · 5h', remainingPercent: 97, resetsAt: '1970-01-01T00:00:00.000Z' }, { label: 'Credits', remaining: '0 credits', resetsAt: null },
    ])
    expect(parseClaude({ five_hour: { utilization: -1 }, seven_day: { utilization: 101 } })).toEqual([])
  })
  it('reads Kimi reported allowance units without assuming a missing used count is zero', () => {
    expect(parseKimi({ usage: { limit: '100', remaining: '40', resetTime: '2026-10-08T12:00:00Z' }, limits: [{ window: { duration: 300, timeUnit: 'MINUTE' }, detail: { limit: 20, used: 20 } }] })).toEqual([
      { label: 'Weekly allowance', remainingPercent: 40, remaining: '40 / 100 allowance units', resetsAt: '2026-10-08T12:00:00.000Z' },
      { label: '300 minute window', remainingPercent: 0, remaining: '0 / 20 allowance units', resetsAt: null },
    ])
    expect(parseKimi({ usage: { limit: 100 } })).toEqual([])
    expect(parseCodex({ credits: { balance: null }, rate_limit: { primary_window: { used_percent: null } } })).toEqual([])
  })
  it('does not reuse account quota after credentials change and identifies empty Kimi files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'credits-'))
    try {
      mkdirSync(join(home, '.claude'))
      mkdirSync(join(home, '.kimi-code/credentials'), { recursive: true })
      const file = join(home, '.claude/.credentials.json')
      writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'first-token' } }))
      writeFileSync(join(home, '.kimi-code/credentials/kimi-code.json'), JSON.stringify({ access_token: '' }))
      const cfg = loadConfig({ dataDir: home, claudeConfigDir: '', captainChain: [] })
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 20 } })))
      const collector = new Credits(request, home)
      const before = await collector.read(cfg)
      expect(before.accounts.find(a => a.runtime === 'Kimi')?.reason).toContain('empty or unsupported')
      writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'different-account-token' } }))
      request.mockResolvedValue(new Response('{}', { status: 401 }))
      const after = await collector.read(cfg)
      expect(after.accounts[0]).toMatchObject({ status: 'unavailable', fetchedAt: null, allowances: [] })
      expect(request).toHaveBeenCalledTimes(2)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('separates OpenRouter funds from key caps and never turns a null cap into unlimited funds', () => {
    expect(parseOpenRouter({ data: { total_credits: 9, total_usage: 4.876990035 } }, { data: { limit: null, limit_remaining: null } })).toEqual([
      { label: 'Account credit balance', remaining: '4.12301 USD', resetsAt: null },
      { label: 'Per-key spending cap', remaining: 'No cap reported', resetsAt: null },
    ])
    expect(parseOpenRouter({ data: { total_credits: null, total_usage: 0 } })).toEqual([])
  })
  it('coalesces concurrent reads, expires cache and preserves stale data with safe errors', async () => {
    const home = mkdtempSync(join(tmpdir(), 'credits-'))
    try {
      mkdirSync(join(home, '.claude'))
      writeFileSync(join(home, '.claude/.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret-test' } }))
      let now = 1000
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 20 } })))
      const collector = new Credits(request, home, () => now)
      const cfg = loadConfig({ dataDir: home, claudeConfigDir: '', captainChain: [] })
      const [a, b] = await Promise.all([collector.read(cfg), collector.read(cfg)])
      expect(request).toHaveBeenCalledTimes(1)
      expect(a).toEqual(b)
      expect(a.accounts[0].status).toBe('available')
      expect(a.accounts.find(x => x.id === 'codex')?.reason).toContain('credentials')
      await collector.read(cfg)
      expect(request).toHaveBeenCalledTimes(1)
      now += 61_000
      request.mockRejectedValue(new Error('secret-test credential leaked in network error'))
      const stale = await collector.read(cfg)
      expect(stale.accounts[0]).toMatchObject({ status: 'stale', fetchedAt: a.accounts[0].fetchedAt, allowances: a.accounts[0].allowances })
      expect(JSON.stringify(stale)).not.toContain('secret-test')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('handles partial OpenRouter failure and uses only the fixed read-only provider hosts', async () => {
    const home = mkdtempSync(join(tmpdir(), 'credits-'))
    try {
      mkdirSync(join(home, '.pi/agent'), { recursive: true })
      writeFileSync(join(home, '.pi/agent/auth.json'), JSON.stringify({ openrouter: { type: 'oauth', access: 'test-key' } }))
      const cfg = loadConfig({ dataDir: home, claudeConfigDir: '', captainChain: [] })
      const request = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/credits')
        ? new Response('private body', { status: 403 })
        : new Response(JSON.stringify({ data: { limit: 20, limit_remaining: 5 } })))
      const result = await new Credits(request, home).read(cfg)
      const router = result.accounts.find(a => a.id === 'pi:openrouter')!
      expect(router).toMatchObject({ status: 'available', note: 'Account credit balance unavailable. The per-key cap does not report account funds.', allowances: [{ label: 'Per-key spending allowance', remaining: '5 USD' }] })
      expect(request.mock.calls.map(([url]) => url)).toEqual(['https://openrouter.ai/api/v1/credits', 'https://openrouter.ai/api/v1/key'])
      expect(request.mock.calls.every(([, opts]) => opts?.redirect === 'error' && opts.signal instanceof AbortSignal)).toBe(true)
      expect(JSON.stringify(result)).not.toContain('test-key')
      expect(JSON.stringify(result)).not.toContain('private body')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('does not query remembered ChatGPT tokens when Codex is configured for API-key auth', async () => {
    const home = mkdtempSync(join(tmpdir(), 'credits-'))
    try {
      mkdirSync(join(home, '.codex'))
      writeFileSync(join(home, '.codex/auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'private-api-key', tokens: { access_token: 'old-chatgpt-token', account_id: 'old-account' } }))
      const request = vi.fn<typeof fetch>()
      const cfg = loadConfig({ dataDir: home, claudeConfigDir: '', captainChain: [] })
      const result = await new Credits(request, home).read(cfg)
      expect(result.accounts.find(a => a.id === 'codex')?.reason).toContain('Stored ChatGPT token remnants are not queried')
      expect(request).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('private-api-key')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('treats changed schemas and rejected authentication as unavailable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'credits-'))
    try {
      mkdirSync(join(home, '.claude'))
      writeFileSync(join(home, '.claude/.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret' } }))
      const cfg = loadConfig({ dataDir: home, claudeConfigDir: '', captainChain: [] })
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
      expect((await new Credits(request, home).read(cfg)).accounts[0].reason).toContain('no recognized')
      request.mockResolvedValue(new Response('private provider body', { status: 401 }))
      const result = await new Credits(request, home).read(cfg)
      expect(result.accounts[0].reason).toContain('HTTP 401')
      expect(JSON.stringify(result)).not.toContain('private provider body')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})
