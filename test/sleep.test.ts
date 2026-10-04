import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { chatPage } from '../src/web/chat.ts'
import { ClaudeSleepModel, runSleep, sleepInput, validate, type SleepModel, type SleepOps } from '../src/sleep/sleep.ts'
import { due } from '../src/sleep/schedule.ts'

const none: SleepOps = { add: [], supersede: [], stale: [], merge: [], digest: '' }

/** A memory whose clock the test moves, so entries land on chosen days. */
function clocked() {
  let now = new Date('2026-10-02T10:00:00')
  const mem = new Memory(':memory:', { clock: () => now })
  return { mem, at: (iso: string) => (now = new Date(iso)) }
}

class Scripted implements SleepModel {
  prompts: string[] = []
  private reply: (prompt: string, n: number) => SleepOps | Error
  constructor(reply: (prompt: string, n: number) => SleepOps | Error) {
    this.reply = reply
  }
  async consolidate(prompt: string): Promise<SleepOps> {
    this.prompts.push(prompt)
    const r = this.reply(prompt, this.prompts.length)
    if (r instanceof Error) throw r
    return r
  }
}

describe('sleepInput', () => {
  it('keeps conversation, decisions, reports and task changes, not plumbing or its own writes', () => {
    const { mem } = clocked()
    const keep = [
      mem.append('owner', 'hi'),
      mem.append('captain', 'hello'),
      mem.append('decision', 'Decision: x. Reason: y'),
      mem.append('agent', 'w reported:\nok', { meta: { agent: 'w', event: 'report' } }),
    ]
    const drop = [
      mem.append('captain', 'NOTHING_TO_REPORT', { meta: { silent: true } }),
      mem.append('agent', 'Majordomo to w: go', { meta: { agent: 'w', event: 'message' } }),
      mem.append('now', 'Now v1'),
      mem.append('rotation', 'rotated'),
      mem.append('fact', 'F1 by sleep', { session: 'sleep', meta: { fact: 1 } }),
    ]
    expect(keep.every(sleepInput)).toBe(true)
    expect(drop.some(sleepInput)).toBe(false)
  })
})

describe('validate', () => {
  it('refuses sources outside the day, unknown or stale facts, double use and bad shapes', () => {
    const { mem } = clocked()
    const l1 = mem.append('owner', 'I moved to Kathmandu')
    const old = mem.factWrite({ kind: 'owner', subject: 'owner city', body: 'Pokhara', source: 'owner' })
    const gone = mem.factWrite({ kind: 'other', subject: 'x', body: 'y', source: 'owner' })
    mem.factMarkStale(gone.id, 'test')
    const day = new Set([l1.id])
    const { ok, skipped } = validate(
      {
        add: [
          { kind: 'owner', subject: 'owner city', body: 'Kathmandu', source: `L${l1.id}` },
          { kind: 'owner', subject: 'elsewhere', body: 'b', source: 'L999' },
          { kind: 'nonsense' as 'owner', subject: 's', body: 'b', source: `L${l1.id}` },
        ],
        supersede: [
          { kind: 'owner', subject: 'owner city', body: 'Kathmandu', source: `L${l1.id}`, replaces: [`F${old.id}`] },
          { kind: 'owner', subject: 'again', body: 'b', source: `L${l1.id}`, replaces: [`F${old.id}`] },
        ],
        stale: [{ id: `F${gone.id}`, reason: 'already stale' }, { id: 'F404', reason: 'missing' }],
        merge: [{ keep: `F${old.id}`, drop: [`F${old.id}`] }],
        digest: ' Moved city. ',
      },
      day,
      mem,
    )
    expect(ok.add.map((f) => f.body)).toEqual(['Kathmandu'])
    expect(ok.supersede).toHaveLength(1)
    expect(ok.stale).toHaveLength(0)
    expect(ok.merge).toHaveLength(0)
    expect(ok.digest).toBe('Moved city.')
    expect(skipped).toEqual([
      'add "elsewhere": source L999 is not in this day',
      'add "s": bad kind, subject or body',
      `supersede "again": replaces F${old.id} - not all live facts`,
      `stale F${gone.id}: not a live fact`,
      'stale F404: not a live fact',
      `merge F${old.id} into F${old.id}: not all live, distinct facts`,
    ])
  })
})

describe('runSleep', () => {
  it('consolidates day by day, appends a digest, moves the cursor, and is idempotent', async () => {
    const { mem, at } = clocked()
    const city = mem.factWrite({ kind: 'owner', subject: 'owner city', body: 'Lives in Pokhara', source: 'owner' })
    const dup1 = mem.factWrite({ kind: 'preference', subject: 'reply length', body: 'Short replies', source: 'owner' })
    const dup2 = mem.factWrite({ kind: 'preference', subject: 'reply style', body: 'Keep replies short', source: 'owner' })
    at('2026-10-02T18:00:00')
    const d1 = mem.append('owner', 'My accountant is Bikash, VAT by the 25th')
    at('2026-10-03T09:00:00')
    const d2 = mem.append('owner', 'I moved to Kathmandu last week')
    mem.append('now', 'Now v1') // plumbing after the last input

    const model = new Scripted((prompt) => {
      if (prompt.includes('date="2026-10-02"'))
        return { ...none, add: [{ kind: 'person', subject: 'accountant', body: 'Bikash files VAT by the 25th.', source: `L${d1.id}` }], merge: [{ keep: `F${dup1.id}`, drop: [`F${dup2.id}`] }], digest: `Owner named the accountant [L${d1.id}].` }
      return { ...none, supersede: [{ kind: 'owner', subject: 'owner city', body: 'Lives in Kathmandu.', source: `L${d2.id}`, replaces: [`F${city.id}`] }], digest: 'Owner moved.' }
    })
    const r = await runSleep(mem, model)
    expect(r.days.map((d) => [d.date, d.added, d.superseded, d.merged])).toEqual([
      ['2026-10-02', 1, 0, 1],
      ['2026-10-03', 0, 1, 0],
    ])
    // The model sees the day's ledger and the facts, with ids to cite.
    expect(model.prompts[0]).toContain(`[L${d1.id} 18:00 owner] My accountant is Bikash`)
    expect(model.prompts[0]).toContain(`F${city.id} [owner] owner city: Lives in Pokhara`)
    expect(model.prompts[0]).not.toContain('I moved to Kathmandu')

    expect(mem.factGet(city.id)).toMatchObject({ stale: true })
    expect(mem.factGet(dup2.id)).toMatchObject({ stale: true, superseded_by: dup1.id })
    expect(mem.searchFacts('owner city').map((h) => h.text)).toEqual(['Lives in Kathmandu.'])
    const digests = mem.ledgerTail(5, ['digest'])
    expect(digests.map((d) => d.text)).toEqual([
      `Digest 2026-10-02: Owner named the accountant [L${d1.id}].\n\nMemory: 1 new fact, 1 merged.`,
      'Digest 2026-10-03: Owner moved.\n\nMemory: 1 updated.',
    ])
    // Its writes are tagged, so the next sleep does not read them as news.
    expect(mem.ledgerTail(20, ['fact']).filter((e) => e.session === 'sleep')).toHaveLength(3)

    const again = await runSleep(mem, model)
    expect(again.days).toEqual([])
    expect(model.prompts).toHaveLength(2)
  })

  it('changes nothing on a dry run', async () => {
    const { mem } = clocked()
    const l = mem.append('owner', 'Remember: invoices on the 1st')
    const model = new Scripted(() => ({ ...none, add: [{ kind: 'preference', subject: 'invoices', body: 'On the 1st.', source: `L${l.id}` }], digest: 'd' }))
    const r = await runSleep(mem, model, { dryRun: true })
    expect(r.proposals[0].ops.add).toHaveLength(1)
    expect(mem.factsAll()).toHaveLength(0)
    expect(mem.ledgerTail(5, ['digest'])).toHaveLength(0)
    expect(mem.metaGet('sleep_cursor')).toBeNull()
  })

  it('keeps finished days when a later day fails, and retries only the rest', async () => {
    const { mem, at } = clocked()
    mem.append('owner', 'day one')
    at('2026-10-03T09:00:00')
    mem.append('owner', 'day two')
    let fail = true
    const model = new Scripted((p) => (p.includes('2026-10-03') && fail ? new Error('overloaded') : { ...none, digest: 'ok' }))
    await expect(runSleep(mem, model)).rejects.toThrow('overloaded')
    expect(mem.ledgerTail(5, ['digest']).map((d) => d.meta?.date)).toEqual(['2026-10-02'])
    fail = false
    const r = await runSleep(mem, model)
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-03'])
  })

  it('splits a very long day into parts', async () => {
    const { mem } = clocked()
    for (let i = 0; i < 30; i++) mem.append('owner', `message ${i} ${'x'.repeat(400)}`)
    const model = new Scripted(() => ({ ...none, digest: 'part' }))
    const r = await runSleep(mem, model, { maxChars: 5000 })
    expect(model.prompts.length).toBeGreaterThan(2)
    expect(r.days).toHaveLength(1)
    expect(r.days[0].digest.split('\n\n').every((p) => p === 'part')).toBe(true)
  })
})

describe('chat after a sleep', () => {
  it('shows one overnight row and none of the sleep receipts', async () => {
    const { mem } = clocked()
    const l = mem.append('owner', 'My accountant is Bikash')
    await runSleep(mem, new Scripted(() => ({ ...none, add: [{ kind: 'person', subject: 'accountant', body: 'Bikash.', source: `L${l.id}` }], digest: 'd' })))
    const items = chatPage(mem, null, 40).items
    expect(items.map((i) => i.type)).toEqual(['owner', 'digest'])
    expect(items[1]).toMatchObject({ text: 'Overnight I tidied memory: 1 new fact' })
  })
})

describe('schedule', () => {
  it('is due once a day, after the slot', () => {
    expect(due('04:00', null, new Date('2026-10-04T03:59:00'))).toBe(false)
    expect(due('04:00', null, new Date('2026-10-04T04:00:00'))).toBe(true)
    expect(due('04:00', '2026-10-04', new Date('2026-10-04T23:00:00'))).toBe(false)
    expect(due('04:00', '2026-10-03', new Date('2026-10-04T09:00:00'))).toBe(true)
    expect(due('', null, new Date())).toBe(false)
  })

  it('rejects a malformed time', () => {
    const prev = process.env.MAJORDOMO_SLEEP_AT
    process.env.MAJORDOMO_SLEEP_AT = '4am'
    try {
      expect(() => loadConfig()).toThrow(/HH:MM/)
    } finally {
      if (prev === undefined) delete process.env.MAJORDOMO_SLEEP_AT
      else process.env.MAJORDOMO_SLEEP_AT = prev
    }
  })
})

// Real haiku on a seeded day: a contradiction, a duplicate, a new durable fact, chit-chat.
describe.skipIf(process.env.MAJORDOMO_LIVE !== '1')('live sleep', () => {
  it('supersedes the changed fact, merges the duplicate, adds the new one, and invents nothing', { timeout: 300_000 }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-sleep-live-'))
    const cfg = loadConfig({ dataDir, sleepModel: process.env.MAJORDOMO_LIVE_MODEL || 'haiku' })
    const { mem, at } = clocked()
    const city = mem.factWrite({ kind: 'owner', subject: 'owner city', body: 'The owner lives in Pokhara.', source: 'owner' })
    const short1 = mem.factWrite({ kind: 'preference', subject: 'reply length', body: 'The owner wants short replies.', source: 'owner' })
    const short2 = mem.factWrite({ kind: 'preference', subject: 'brief answers', body: 'Owner prefers brief answers, not long ones.', source: 'owner' })
    const stock = mem.factWrite({ kind: 'project', subject: 'stockmate', body: 'StockMate is an inventory app for a retail client.', source: 'owner' })
    at('2026-10-03T09:00:00')
    mem.append('owner', 'Morning! How are you today?')
    mem.append('captain', 'Good morning. Ready when you are.')
    const moved = mem.append('owner', 'Update: I moved to Kathmandu last week, so use Kathmandu for anything location related.')
    mem.append('captain', 'Noted, Kathmandu from now on.')
    const acct = mem.append('owner', 'Also, my accountant is Bikash. He files the VAT return by the 25th of every month.')
    mem.append('owner', 'lol the weather is crazy today')
    const r = await runSleep(mem, new ClaudeSleepModel({ bin: cfg.claudeBin, model: cfg.sleepModel, promptFile: cfg.sleepPromptFile, timeoutSec: 240, cwd: dataDir }))
    console.info(JSON.stringify(r.proposals, null, 2), r.days.map((d) => d.skipped))

    expect(mem.factGet(city.id)?.stale).toBe(true)
    const live = mem.factsAll()
    expect(live.some((f) => /kathmandu/i.test(f.body) && f.source === `L${moved.id}`)).toBe(true)
    expect(live.some((f) => /bikash/i.test(f.body) && f.source === `L${acct.id}`)).toBe(true)
    expect([short1, short2].filter((f) => mem.factGet(f.id)?.stale)).toHaveLength(1)
    expect(mem.factGet(stock.id)?.stale).toBe(false)
    expect(live.some((f) => /weather/i.test(f.body))).toBe(false)
    expect(r.days.find((d) => d.date === '2026-10-03')?.digest).toMatch(/kathmandu/i)
  })
})
