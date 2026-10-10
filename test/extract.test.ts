// The quick fact pass between nightly sleeps.
import { describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { ClaudeSleepModel, extractPending, opsSchema, runExtract, runSleep, type ModelUsage, type SleepModel, type SleepOps } from '../src/sleep/sleep.ts'
import { extractDue, extractLine, startExtractSchedule } from '../src/sleep/schedule.ts'

const none: SleepOps = { add: [], supersede: [], stale: [], merge: [], digest: '' }

function clocked() {
  let now = new Date('2026-10-10T10:00:00')
  const mem = new Memory(':memory:', { clock: () => now })
  return { mem, at: (iso: string) => (now = new Date(iso)) }
}

class Scripted implements SleepModel {
  calls: { prompt: string; extract: boolean }[] = []
  private reply: (prompt: string, n: number) => SleepOps | Error
  usage: ModelUsage | undefined
  constructor(reply: (prompt: string, n: number) => SleepOps | Error, usage?: ModelUsage) {
    this.reply = reply
    this.usage = usage
  }
  async consolidate(prompt: string, opts: { extract?: boolean } = {}) {
    this.calls.push({ prompt, extract: !!opts.extract })
    const r = this.reply(prompt, this.calls.length)
    if (r instanceof Error) throw r
    return { ...r, usage: this.usage }
  }
}

const lid = (prompt: string, text: string) => `L${/\[L(\d+) [^\]]*\] (.*)/g.exec(prompt.split('\n').find((l) => l.includes(text))!)![1]}`

describe('runExtract', () => {
  it('reads only what is new, writes facts without a digest, and moves its own cursor', async () => {
    const { mem } = clocked()
    mem.append('owner', 'my PC is an Alienware 17 R4')
    mem.append('now', 'Now v1')
    const model = new Scripted((p) => ({ ...none, add: [{ kind: 'project', subject: 'owner PC', body: 'Alienware 17 R4', source: lid(p, 'Alienware') }], digest: 'ignored' }), {
      costUsd: 0.002,
      inputTokens: 3000,
      outputTokens: 120,
      ms: 4000,
    })
    const r = await runExtract(mem, model)
    expect(model.calls).toHaveLength(1)
    expect(model.calls[0].extract).toBe(true)
    expect(model.calls[0].prompt).toMatch(/^<pass>Quick pass/)
    expect(r).toMatchObject({ from: 1, to: 1, entries: 1, calls: 1, added: 1, usage: { costUsd: 0.002, inputTokens: 3000 } })
    expect(mem.factsAll().map((f) => f.subject)).toEqual(['owner PC'])
    expect(mem.ledgerTail(10, ['digest'])).toEqual([])
    // Past the trailing Now, but not past what was written during the run (the owner may have said something).
    expect(Number(mem.metaGet('extract_cursor'))).toBe(2)
    mem.append('owner', 'said while the pass ran')
    expect(extractPending(mem).count).toBe(1)
    expect(extractLine(r)).toMatch(/L1-L1 \(1 entries\): 1 new fact; 1 call, 3000 in \/ 120 out tokens, \$0\.0020/)

    await runExtract(mem, new Scripted(() => none))
    const again = await runExtract(mem, model)
    expect(again.entries).toBe(0)
    expect(model.calls).toHaveLength(1)
  })

  it('starts after the nightly sleep, and the sleep still digests the whole day', async () => {
    const { mem } = clocked()
    mem.append('owner', 'old news')
    await runSleep(mem, new Scripted(() => ({ ...none, digest: 'day one' })))
    mem.append('owner', 'the SSD hit 80C')
    const quick = new Scripted((p) => ({ ...none, add: [{ kind: 'project', subject: 'ssd temp', body: 'hit 80C', source: lid(p, '80C') }] }))
    await runExtract(mem, quick)
    expect(quick.calls[0].prompt).not.toMatch(/old news/)
    // The next sleep reads the day from its own cursor and sees the fact the quick pass wrote.
    const night = new Scripted(() => ({ ...none, digest: 'the ssd ran hot' }))
    const r = await runSleep(mem, night)
    expect(night.calls[0].prompt).toMatch(/80C/)
    expect(night.calls[0].prompt).toMatch(/F1 \[project\] ssd temp/)
    expect(r.days[0].digest).toBe('the ssd ran hot')
    // ... and the quick pass does not re-read what the sleep covered.
    expect(extractPending(mem).count).toBe(0)
  })

  it('validates like the sleep: a source outside the batch is refused', async () => {
    const { mem } = clocked()
    mem.append('owner', 'hello')
    const r = await runExtract(mem, new Scripted(() => ({ ...none, add: [{ kind: 'owner', subject: 'x', body: 'y', source: 'L999' }] })))
    expect(r.added).toBe(0)
    expect(r.skipped[0]).toMatch(/not in this day/)
  })

  it('keeps the parts already applied when a later part fails', async () => {
    const { mem } = clocked()
    for (let i = 0; i < 6; i++) mem.append('owner', `message ${i} ${'x'.repeat(200)}`)
    const model = new Scripted((_, n) => (n === 2 ? new Error('model down') : none))
    await expect(runExtract(mem, model, { maxChars: 600 })).rejects.toThrow('model down')
    const cursor = Number(mem.metaGet('extract_cursor'))
    expect(cursor).toBeGreaterThan(0)
    expect(cursor).toBeLessThan(6)
    expect(extractPending(mem).count).toBe(6 - cursor)
  })
})

describe('extract schedule', () => {
  it('is due on enough entries, or on an old enough one, never when off or empty', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    expect(extractDue({ count: 30, oldest: '2026-10-10T11:59:00Z' }, 30, 60, now)).toBe(true)
    expect(extractDue({ count: 3, oldest: '2026-10-10T10:59:00Z' }, 30, 60, now)).toBe(true)
    expect(extractDue({ count: 3, oldest: '2026-10-10T11:30:00Z' }, 30, 60, now)).toBe(false)
    expect(extractDue({ count: 0, oldest: null }, 30, 60, now)).toBe(false)
    expect(extractDue({ count: 99, oldest: '2026-10-10T00:00:00Z' }, 0, 60, now)).toBe(false)
  })

  it('runs in the background and logs each run', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'wed-extract-'))
    const cfg = loadConfig({ dataDir, extractEvery: 2, extractMinutes: 60 })
    const mem = new Memory(cfg.dbPath)
    mem.append('owner', 'one')
    mem.append('owner', 'two')
    const logs: string[] = []
    const stop = startExtractSchedule(mem, cfg, new Scripted(() => none), (s) => logs.push(s), 20)
    try {
      for (let i = 0; i < 100 && !logs.length; i++) await new Promise((r) => setTimeout(r, 20))
    } finally {
      stop()
    }
    expect(logs[0]).toMatch(/^extract: L1-L2 \(2 entries\): nothing to change/)
    const line = JSON.parse(readFileSync(join(dataDir, 'logs', 'extract.jsonl'), 'utf8').trim().split('\n')[0])
    expect(line).toMatchObject({ from: 1, to: 2, entries: 2 })
    expect(existsSync(join(dataDir, 'consolidate.lock'))).toBe(false)
  })
})

describe('ClaudeSleepModel', () => {
  it('asks for facts only on the quick pass and reports cost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wed-bin-'))
    const bin = join(dir, 'claude')
    // Echoes whether the schema it was given requires a digest.
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const a = process.argv; const schema = JSON.parse(a[a.indexOf('--json-schema') + 1])
process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({
  structured_output: { add: [], supersede: [], stale: [], merge: [], ...(schema.required.includes('digest') ? { digest: 'full' } : {}) },
  total_cost_usd: 0.0031, usage: { input_tokens: 10, cache_read_input_tokens: 2000, output_tokens: 50 } })))
`,
    )
    chmodSync(bin, 0o755)
    const prompt = join(dir, 'sleep.md')
    writeFileSync(prompt, 'sleep')
    const model = new ClaudeSleepModel({ bin, model: 'haiku', promptFile: prompt, timeoutSec: 10, cwd: dir })
    const quick = await model.consolidate('x', { extract: true })
    expect(quick.digest).toBe('')
    expect(quick.usage).toMatchObject({ costUsd: 0.0031, inputTokens: 2010, outputTokens: 50 })
    expect((await model.consolidate('x')).digest).toBe('full')
    expect(opsSchema({ digest: false }).required).not.toContain('digest')
    expect(opsSchema().required).toContain('digest')
  })
})
