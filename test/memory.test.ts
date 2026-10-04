import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ftsQuery, Memory, parseRef } from '../src/memory/store.ts'

const mk = (opts = {}) => new Memory(':memory:', opts)

describe('ledger', () => {
  it('is append-only', () => {
    const m = mk()
    const e = m.append('owner', 'hello there')
    expect(() => m.db.exec(`UPDATE ledger SET text = 'x' WHERE id = ${e.id}`)).toThrow(/append-only/)
    expect(() => m.db.exec(`DELETE FROM ledger WHERE id = ${e.id}`)).toThrow(/append-only/)
    expect(m.ledgerGet(e.id)?.text).toBe('hello there')
  })

  it('returns the tail oldest first, filtered by kind', () => {
    const m = mk()
    m.append('owner', 'one')
    m.append('system', 'noise')
    m.append('captain', 'two')
    m.append('owner', 'three')
    expect(m.ledgerTail(2, ['owner', 'captain']).map((e) => e.text)).toEqual(['two', 'three'])
  })

  it('searches with stemming and keeps ids', () => {
    const m = mk()
    m.append('owner', 'We decided to deploy the scrapers on Hetzner')
    m.append('owner', 'unrelated chatter about lunch')
    const hits = m.searchLedger('deployment of scraper')
    expect(hits[0]?.ref).toBe('L1')
  })
})

describe('facts', () => {
  it('supersedes older facts and hides stale ones by default', () => {
    const m = mk()
    const a = m.factWrite({ kind: 'owner', subject: 'owner city', body: 'Lives in Pokhara', source: 'owner' })
    const b = m.factWrite({ kind: 'owner', subject: 'owner city', body: 'Moved to Kathmandu', source: 'L9', supersedes: [a.id] })
    expect(m.factGet(a.id)).toMatchObject({ stale: true, superseded_by: b.id })
    expect(m.searchFacts('owner city').map((h) => h.ref)).toEqual([`F${b.id}`])
    expect(m.searchFacts('owner city', 8, true)).toHaveLength(2)
    expect(m.ledgerTail(10, ['fact']).at(-1)?.text).toContain(`supersedes F${a.id}`)
  })

  it('rolls back when superseding a missing fact', () => {
    const m = mk()
    expect(() => m.factWrite({ kind: 'other', subject: 's', body: 'b', source: 'owner', supersedes: [99] })).toThrow(/F99/)
    expect(m.factsAll()).toHaveLength(0)
    expect(m.ledgerTail(5)).toHaveLength(0)
  })

  it('reindexes on body change', () => {
    const m = mk()
    const f = m.factWrite({ kind: 'other', subject: 'colour', body: 'blue', source: 'owner' })
    m.db.prepare('UPDATE facts SET body = ? WHERE id = ?').run('green', f.id)
    expect(m.searchFacts('blue')).toHaveLength(0)
    expect(m.searchFacts('green')).toHaveLength(1)
  })
})

describe('tasks', () => {
  it('logs status transitions with from/to', () => {
    const m = mk()
    const t = m.taskCreate({ title: 'Ship memory', goal: 'so the captain survives rotation' })
    m.taskUpdate(t.id, { status: 'done', result: 'merged' })
    const last = m.ledgerTail(1, ['task'])[0]
    expect(last.meta).toMatchObject({ task: t.id, status: 'done', from: 'open' })
    expect(m.taskList({ open: true })).toHaveLength(0)
    expect(m.searchTasks('rotation')[0]?.ref).toBe(`T${t.id}`)
  })
})

describe('now', () => {
  it('versions updates and enforces the budget', () => {
    const m = mk({ nowBudgetChars: 50 })
    expect(m.nowGet().version).toBe(0)
    m.nowUpdate('Goal: build jarvis')
    expect(m.nowGet()).toMatchObject({ text: 'Goal: build jarvis', version: 1 })
    expect(() => m.nowUpdate('x'.repeat(51))).toThrow(/budget/)
    expect(m.nowGet().version).toBe(1)
  })
})

describe('sessions', () => {
  it('tracks the live session and its peak', () => {
    const m = mk()
    m.sessionStart('s1')
    m.sessionTurn('s1', 1000, 200000)
    m.sessionTurn('s1', 500, 200000)
    expect(m.sessionCurrent()).toMatchObject({ id: 's1', turns: 2, peak_tokens: 1000 })
    m.sessionEnd('s1', 'test')
    expect(m.sessionCurrent()).toBeNull()
  })
})

describe('schema safety', () => {
  it('refuses a foreign database instead of writing to it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-'))
    const path = join(dir, 'other.db')
    const d = new DatabaseSync(path)
    d.exec('CREATE TABLE important(x)')
    d.close()
    expect(() => new Memory(path)).toThrow(/not a Jarvis database/)
  })

  it('refuses a schema version it does not know', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-'))
    const path = join(dir, 'm.db')
    new Memory(path).close()
    const d = new DatabaseSync(path)
    d.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    d.close()
    expect(() => new Memory(path)).toThrow(/v99/)
  })
})

describe('helpers', () => {
  it('builds safe FTS queries', () => {
    expect(ftsQuery('What did we decide about "NEPSE" API?')).toBe('"decide" OR "nepse" OR "api"')
    expect(ftsQuery('and the of')).toBe('')
    expect(ftsQuery('AND OR NOT (')).toBe('')
  })

  it('parses refs', () => {
    expect(parseRef('f12')).toEqual({ kind: 'fact', id: 12 })
    expect(parseRef('L3')).toEqual({ kind: 'ledger', id: 3 })
    expect(parseRef('X3')).toBeNull()
  })
})

describe('plain dash rule', () => {
  it('replaces em and en dashes everywhere memory is written', async () => {
    const { plainDash } = await import('../src/text.ts')
    expect(plainDash('Sunchadi — a tracker')).toBe('Sunchadi - a tracker')
    expect(plainDash('yet—at least')).toBe('yet-at least')
    expect(plainDash('2024–2025')).toBe('2024-2025')
    const m = mk()
    expect(m.nowUpdate('a — b').text).toBe('a - b')
    expect(m.factWrite({ kind: 'other', subject: 'x—y', body: 'p — q', source: 'owner' })).toMatchObject({ subject: 'x-y', body: 'p - q' })
    expect(m.taskCreate({ title: 't — 1', goal: 'g' }).title).toBe('t - 1')
    expect(m.append('owner', 'hi — there').text).toBe('hi - there')
  })
})
