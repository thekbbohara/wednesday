import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { Captain } from '../src/captain/captain.ts'
import { isUsageLimit, parseChain, type Provider } from '../src/captain/provider.ts'
import { parseCodexEvents } from '../src/captain/codex.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

describe('parseChain', () => {
  it('always leads with the primary Claude login, then fallbacks in order', () => {
    expect(parseChain(undefined).map((p) => p.id)).toEqual(['claude'])
    const chain = parseChain('claude:~/.claude-2, codex, codex:gpt-5')
    expect(chain.map((p) => p.id)).toEqual(['claude', 'claude@.claude-2', 'codex', 'codex:gpt-5'])
    expect(chain[1]).toMatchObject({ kind: 'claude', configDir: join(homedir(), '.claude-2') })
    expect(chain[3]).toMatchObject({ kind: 'codex', model: 'gpt-5' })
  })

  it('stamps the primary with its CLAUDE_CONFIG_DIR and rejects bad entries', () => {
    expect(parseChain(undefined, '~/.claude-work')[0].configDir).toBe(join(homedir(), '.claude-work'))
    expect(() => parseChain('claude')).toThrow(/needs a config dir/)
    expect(() => parseChain('gpt4')).toThrow(/unknown entry/)
  })
})

describe('isUsageLimit', () => {
  it('matches caps and rate limits, not transient overload', () => {
    for (const t of ['Claude usage limit reached', 'rate limit exceeded', '429 Too Many Requests', 'You are out of credits', 'your limit will reset at 5pm'])
      expect(isUsageLimit(t), t).toBe(true)
    for (const t of ['API overloaded, try again', 'network error', 'invalid request', '529'])
      expect(isUsageLimit(t), t).toBe(false)
  })
})

describe('parseCodexEvents', () => {
  it('reads the thread id, final message and token use from JSONL', () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t-abc"}',
      '{"type":"item.completed","item":{"id":"i0","type":"error","message":"a warning"}}',
      '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}',
    ].join('\n')
    expect(parseCodexEvents(jsonl)).toEqual({ threadId: 't-abc', text: 'hello', tokens: 105, error: '' })
    expect(parseCodexEvents('{"type":"turn.failed","error":{"message":"usage limit"}}')).toMatchObject({ text: '', error: 'usage limit' })
  })
})

// A fake runner per provider: it fails with a usage-limit message until the
// test "refills" that provider.
class ChainFake implements Runner {
  calls: { provider: string; resume: boolean; session: string }[] = []
  limited = new Set<string>()
  known = new Set<string>()
  provider: Provider
  constructor(provider: Provider) {
    this.provider = provider
  }
  async run(req: TurnRequest): Promise<TurnResult> {
    this.calls.push({ provider: this.provider.id, resume: req.resume, session: req.sessionId })
    if (req.resume && !this.known.has(req.sessionId)) return { text: 'No conversation found', isError: true, sessionMissing: true, contextTokens: 0, contextWindow: null, costUsd: 0 }
    if (this.limited.has(this.provider.id)) return { text: 'Claude usage limit reached', isError: true, contextTokens: 0, contextWindow: null, costUsd: 0 }
    this.known.add(req.sessionId)
    return { text: `ok from ${this.provider.id}`, contextTokens: 1000, contextWindow: 200000, costUsd: 0, isError: false }
  }
}

function setup(fallbacks: string, clock?: () => Date) {
  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-chain-'))
  const cfg = loadConfig({ dataDir, captainChain: parseChain(fallbacks), limitCooldownMs: 60_000 })
  const mem = new Memory(cfg.dbPath, clock ? { clock } : {})
  const fakes = new Map<string, ChainFake>()
  const captain = new Captain(mem, cfg, (p) => {
    let f = fakes.get(p.id)
    if (!f) fakes.set(p.id, (f = new ChainFake(p)))
    return f
  })
  if (clock) captain.clock = () => clock().getTime()
  return { mem, cfg, captain, fakes }
}

describe('captain provider failover', () => {
  it('stays on the primary while it works', async () => {
    const { captain, fakes } = setup('codex')
    const r = await captain.handle('hi')
    expect(r.text).toBe('ok from claude')
    expect(fakes.get('codex')).toBeUndefined() // never built
  })

  it('fails over to the next provider on a usage limit, on a fresh session, and records it', async () => {
    const { mem, captain, fakes } = setup('claude:~/.acct2, codex')
    ;(fakes.get('claude') ?? (await captain.handle('warm'), fakes.get('claude'))!) // build primary
    fakes.get('claude')!.limited.add('claude')
    const r = await captain.handle('do it')
    expect(r.text).toBe('ok from claude@.acct2')
    // claude was tried and failed; acct2 answered on a fresh (non-resume) session
    const acct2 = fakes.get('claude@.acct2')!
    expect(acct2.calls.every((c) => !c.resume || acct2.known.has(c.session))).toBe(true)
    expect(mem.ledgerTail(10, ['system']).some((e) => /Claude .*hit its usage limit/.test(e.text))).toBe(true)
    // the reply is tagged with the fallback provider
    const reply = mem.ledgerTail(1, ['captain'])[0]
    expect(reply.meta?.provider).toBe('claude@.acct2')
  })

  it('surfaces an error only when every provider is limited', async () => {
    const { captain, fakes } = setup('codex')
    await captain.handle('warm') // builds both? only claude so far
    for (const id of ['claude', 'codex']) {
      // ensure both runners exist, then limit them
      ;(fakes.get(id) as ChainFake | undefined)?.limited?.add(id)
    }
    // build codex by forcing a failover, then limit it too
    fakes.get('claude')!.limited.add('claude')
    await captain.handle('switch') // moves to codex, builds it
    fakes.get('codex')!.limited.add('codex')
    const r = await captain.handle('now both down')
    expect(r.error).toBe(true)
    expect(r.text).toMatch(/every captain provider is at its usage limit/)
  })

  it('returns to the primary after its cooldown passes', async () => {
    let now = new Date('2026-10-04T10:00:00Z')
    const { mem, captain, fakes } = setup('codex', () => now)
    await captain.handle('warm')
    fakes.get('claude')!.limited.add('claude')
    expect((await captain.handle('a')).text).toBe('ok from codex')
    // still cooling: stays on codex
    fakes.get('claude')!.limited.delete('claude')
    expect((await captain.handle('b')).text).toBe('ok from codex')
    // cooldown (60s) passes -> primary is tried again
    now = new Date(now.getTime() + 61_000)
    expect((await captain.handle('c')).text).toBe('ok from claude')
    void mem
  })
})
