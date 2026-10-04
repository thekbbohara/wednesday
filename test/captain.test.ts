// Captain loop with a scripted runner: prompt assembly, ledgering and rotation.
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { Captain } from '../src/captain/captain.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

type Script = (req: TurnRequest, mem: Memory) => Partial<TurnResult>

class FakeRunner implements Runner {
  calls: TurnRequest[] = []
  private known = new Set<string>()
  private mem: Memory
  private script: Script
  constructor(mem: Memory, script: Script = () => ({})) {
    this.mem = mem
    this.script = script
  }
  async run(req: TurnRequest): Promise<TurnResult> {
    this.calls.push(req)
    if (req.resume && !this.known.has(req.sessionId)) return { text: 'No conversation found', isError: true, sessionMissing: true, contextTokens: 0, contextWindow: null, costUsd: 0 }
    this.known.add(req.sessionId)
    return { text: 'ok', contextTokens: 10_000, contextWindow: 200_000, costUsd: 0, isError: false, ...this.script(req, this.mem) }
  }
  forget() {
    this.known.clear()
  }
}

function setup(script?: Script, cfg = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-cap-'))
  const config = loadConfig({ dataDir, ...cfg })
  const mem = new Memory(config.dbPath)
  const runner = new FakeRunner(mem, script)
  return { mem, runner, captain: new Captain(mem, config, () => runner) }
}

describe('captain', () => {
  it('ledgers both sides and keeps one session across turns', async () => {
    const { mem, runner, captain } = setup()
    const a = await captain.handle('hello')
    const b = await captain.handle('again')
    expect(a.sessionId).toBe(b.sessionId)
    expect(runner.calls.map((c) => c.resume)).toEqual([false, true])
    expect(mem.ledgerTail(10, ['owner', 'captain']).map((e) => `${e.kind}:${e.text}`)).toEqual(['owner:hello', 'captain:ok', 'owner:again', 'captain:ok'])
    expect(runner.calls[0].mcpServers.jarvis.env).toMatchObject({ JARVIS_SESSION: a.sessionId })
  })

  it('primes a fresh session with Now, open tasks, conversation tail and recall; resumed turns stay lean', async () => {
    const { mem, runner, captain } = setup()
    mem.nowUpdate('Goal: build Jarvis step 1. Why: one chat forever.')
    mem.taskCreate({ title: 'Memory service', goal: 'durable memory' })
    mem.factWrite({ kind: 'decision', subject: 'memory backend', body: 'SQLite FTS5', source: 'owner' })
    await captain.handle('what memory backend did we choose?')
    const first = runner.calls[0].message
    expect(first).toContain('<now version="1"')
    expect(first).toContain('T1 [open] Memory service')
    expect(first).toMatch(/<recalled[\s\S]*F1 .*SQLite FTS5/)
    expect(first).toMatch(/<owner_message id="L\d+"/)

    await captain.handle('and the memory backend again?')
    const second = runner.calls[1].message
    expect(second).not.toContain('<now')
    expect(second).not.toContain('<open_tasks>')
    expect(second).not.toContain('F1 ') // already shown in this session
  })

  it('re-shows Now on a resumed turn only when someone else changed it', async () => {
    const { mem, runner, captain } = setup((req, m) => {
      if (req.message.includes('update yourself')) m.nowUpdate('captain wrote this', req.sessionId)
      return {}
    })
    await captain.handle('hi')
    await captain.handle('update yourself')
    await captain.handle('next')
    expect(runner.calls[2].message).not.toContain('<now')
    mem.nowUpdate('changed by the nightly sleep')
    await captain.handle('next again')
    expect(runner.calls[3].message).toContain('changed by the nightly sleep')
  })

  it('rotates at the context threshold, with a handoff turn first', async () => {
    const { mem, runner, captain } = setup((req) => (/<owner_message[^>]*>\nbig/.test(req.message) ? { contextTokens: 81_000 } : {}))
    const r1 = await captain.handle('small')
    const r2 = await captain.handle('big')
    expect(r2.rotated).toMatch(/context at 41%/)
    expect(runner.calls[2].message).toContain('Session rotation')
    expect(runner.calls[2].sessionId).toBe(r1.sessionId)
    const r3 = await captain.handle('after')
    expect(r3.sessionId).not.toBe(r1.sessionId)
    expect(runner.calls[3].resume).toBe(false)
    // The fresh session sees what was said before it.
    expect(runner.calls[3].message).toMatch(/<recent_conversation[\s\S]*owner\] small[\s\S]*owner\] big/)
    expect(mem.sessions().map((s) => s.end_reason)).toEqual([expect.stringMatching(/context/), null])
    expect(mem.ledgerTail(20, ['rotation'])).toHaveLength(1)
  })

  it('does not rotate on context when the first turn of a session is already over the line', async () => {
    const { mem, captain } = setup(() => ({ contextTokens: 150_000 }))
    expect((await captain.handle('one')).rotated).toBeUndefined()
    expect((await captain.handle('two')).rotated).toMatch(/context/)
    expect(mem.sessions()).toHaveLength(1)
  })

  it('rotates when a task closes during the turn', async () => {
    const { mem, captain } = setup((req, m) => {
      if (req.message.includes('finish it')) m.taskUpdate(1, { status: 'done', result: 'done' }, req.sessionId)
      return {}
    })
    mem.taskCreate({ title: 't', goal: 'g' })
    expect((await captain.handle('start')).rotated).toBeUndefined()
    expect((await captain.handle('finish it')).rotated).toBe('task T1 closed')
  })

  it('rotates after maxTurns as a backstop', async () => {
    const { captain } = setup(undefined, { maxTurns: 2 })
    expect((await captain.handle('1')).rotated).toBeUndefined()
    expect((await captain.handle('2')).rotated).toMatch(/2 turns/)
  })

  it('starts fresh if Claude Code lost the session, without losing the message', async () => {
    const { mem, runner, captain } = setup()
    const a = await captain.handle('remember the tea')
    runner.forget()
    const b = await captain.handle('still there?')
    expect(b.error).toBeUndefined()
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(runner.calls.at(-1)!.message).toMatch(/<recent_conversation[\s\S]*remember the tea[\s\S]*<owner_message[^>]*>\nstill there\?/)
    expect(mem.sessions().find((s) => s.id === a.sessionId)?.end_reason).toBe('missing')
  })

  it('resumes the live session after a process restart and re-primes it', async () => {
    const { mem, runner, captain } = setup()
    mem.nowUpdate('Goal: x')
    const a = await captain.handle('one')
    const config = loadConfig({ dataDir: (captain as unknown as { cfg: { dataDir: string } }).cfg.dataDir })
    const restarted = new Captain(mem, config, () => runner)
    const b = await restarted.handle('two')
    expect(b.sessionId).toBe(a.sessionId)
    expect(runner.calls.at(-1)!.resume).toBe(true)
    expect(runner.calls.at(-1)!.message).toContain('<now version="1"')
  })

  it('records failures in the ledger and ends a session that never started', async () => {
    const { mem, captain } = setup(() => ({ isError: true, text: 'boom' }))
    const r = await captain.handle('hi')
    expect(r.error).toBe(true)
    expect(mem.ledgerTail(1)[0]).toMatchObject({ kind: 'system', text: 'Captain turn failed: boom' })
    expect(mem.sessionCurrent()).toBeNull()
  })
})
