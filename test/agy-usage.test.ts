import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAgy } from '../src/agy-usage.ts'
import { Credits } from '../src/credits.ts'
import { loadConfig } from '../src/config.ts'
import { classify, readChoices } from '../src/agents/activity.ts'
import { loadRuntimes } from '../src/agents/runtimes.ts'
import { launchSpec } from '../src/agents/supervisor.ts'

const result = (name: string, data: unknown) => ({ status: 'SUCCESS', num_turns: 0, usage: { total_tokens: 0 }, command: { name, data } })
const usage = result('usage', { groups: [{ name: 'Gemini Models', buckets: [
  { name: 'Weekly Limit Remaining', remaining_fraction: 0, reset_time: '2026-10-14T19:24:20Z' },
  { name: 'Five Hour Limit Remaining', remaining_fraction: 0.625 },
  { name: 'Invalid', remaining_fraction: 2 },
] }] })

describe('Antigravity runtime and quotas', () => {
  it('recognizes the observed trust screen before delivering a brief', () => {
    const screen = 'Accessing workspace:\n\n/tmp/work\n\nDo you trust the contents of this project?\n\nAntigravity CLI requires permission to read, edit, and execute files here.\n\n> Yes, I trust this folder\n  No, exit\n\n  ↑/↓ Navigate · enter Confirm\n'
    expect(classify({ human: false, dead: false, exitCode: null, command: 'agy', screen, sinceChange: Infinity })).toEqual({ mood: 'needs', reason: 'trust prompt' })
    expect(readChoices(screen)).toEqual([{ label: 'Yes, I trust this folder', selected: true }, { label: 'No, exit', selected: false }])
    const runtime = loadRuntimes('/nonexistent').find(r => r.id === 'agy')!
    expect(launchSpec('agyworker', runtime, { hook: null, hookScript: '', claudeConfigDir: '' })).toEqual({ command: 'unset CLAUDE_CONFIG_DIR; agy --model gemini-3.8-flash-medium', env: { MAJORDOMO_AGENT: 'agyworker' } })
  })
  it('uses reported fractions and credits, rejecting inference and unsupported output', () => {
    expect(parseAgy(usage, 'usage')).toEqual([
      { label: 'Gemini Models · Weekly Limit Remaining', remainingPercent: 0, resetsAt: '2026-10-14T19:24:20.000Z' },
      { label: 'Gemini Models · Five Hour Limit Remaining', remainingPercent: 62.5, resetsAt: null },
    ])
    expect(parseAgy(result('credits', { remaining_credits: 0 }), 'credits')).toEqual([{ label: 'AI credits', remaining: '0 credits', resetsAt: null }])
    for (const bad of [null, {}, { ...usage, num_turns: 1 }, { ...usage, usage: { total_tokens: 1 } }, result('model', {})]) expect(parseAgy(bad, 'usage')).toEqual([])
  })
  it('coalesces reads, reports partial availability, and sanitizes subprocess errors', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agy-quotas-'))
    try {
      const cfg = loadConfig({ dataDir: home, claudeConfigDir: '', captainChain: [] })
      let now = 0
      const reader = vi.fn(async (command: string) => command === 'usage' ? usage : result('credits', { remaining_credits: 0 }))
      const credits = new Credits(vi.fn(), home, () => now, reader)
      const first = await Promise.all([credits.read(cfg), credits.read(cfg)])
      expect(first[0].accounts.find(a => a.id === 'agy')).toMatchObject({ status: 'available', allowances: expect.any(Array) })
      expect(reader).toHaveBeenCalledTimes(2)
      now = 61_000
      reader.mockImplementation(async command => { if (command === 'credits') throw new Error('secret-token'); return usage })
      expect((await credits.read(cfg)).accounts.find(a => a.id === 'agy')?.note).toContain('One CLI quota source is unavailable')
      now = 122_000
      reader.mockRejectedValue(new Error('secret-token'))
      const stale = (await credits.read(cfg)).accounts.find(a => a.id === 'agy')!
      expect(stale.status).toBe('stale')
      expect(JSON.stringify(stale)).not.toContain('secret-token')
      // A changed CLI account discards stale allowances, even inside the cache TTL.
      mkdirSync(join(home, '.gemini/antigravity-cli'), { recursive: true })
      writeFileSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'), 'opaque-test-data')
      expect((await credits.read(cfg)).accounts.find(a => a.id === 'agy')).toMatchObject({ status: 'unavailable', allowances: [], fetchedAt: null })
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})
