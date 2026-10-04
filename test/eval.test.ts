import { describe, expect, it } from 'vitest'
import { ftsQuery, Memory } from '../src/memory/store.ts'
import { buildScenario, NEVER_SAID, PLANTS } from '../src/eval/scenario.ts'
import { citations, matches, score } from '../src/eval/score.ts'
import { renderReport, summarize, type Row } from '../src/eval/report.ts'

const terms = (s: string) => new Set(ftsQuery(s).split(' OR ').filter(Boolean))

describe('scenario', () => {
  const sc = buildScenario({ turns: 520, seed: 7 })

  it('is deterministic and has every planned turn', () => {
    expect(buildScenario({ turns: 520, seed: 7 })).toEqual(sc)
    expect(sc).toHaveLength(520)
    expect(sc.filter((t) => t.kind === 'plant')).toHaveLength(PLANTS.length)
    expect(sc.filter((t) => t.kind === 'update')).toHaveLength(PLANTS.filter((p) => p.update).length)
    expect(sc.filter((t) => t.kind === 'probe')).toHaveLength(PLANTS.length * 2 + NEVER_SAID.length)
    expect(sc.filter((t) => t.kind === 'noise').length).toBeGreaterThan(400)
  })

  it('asks each probe long after the plant, and updates before their probes', () => {
    const at = (kind: string, plant: string) => sc.find((t) => t.kind === kind && t.plant === plant)!.index
    for (const p of PLANTS) {
      const probes = sc.filter((t) => t.kind === 'probe' && t.plant === p.id)
      expect(probes).toHaveLength(2)
      for (const q of probes) {
        expect(q.index - at('plant', p.id)).toBeGreaterThan(200)
        if (p.update) expect(q.index).toBeGreaterThan(at('update', p.id))
      }
    }
  })

  it('paraphrases share no search term with what was said', () => {
    const overlaps = PLANTS.map((p) => [p.id, [...terms(p.paraphrase)].filter((t) => terms(p.say).has(t) || (p.update && terms(p.update.say).has(t)))] as const).filter(
      ([, shared]) => shared.length,
    )
    expect(overlaps).toEqual([])
  })
})

describe('score', () => {
  const mem = new Memory(':memory:')
  const l = mem.append('owner', 'StockMate will be hosted on Hetzner.')
  const f = mem.factWrite({ kind: 'project', subject: 'stockmate hosting', body: 'Moved to DigitalOcean.', source: `L${l.id}` })
  const probe = (kind: 'recall' | 'updated' | 'never-said', expect: string[][], old?: string[]) =>
    ({ index: 0, kind: 'probe' as const, text: 'q', probe: { kind, phrasing: 'direct' as const, expect, old } })

  it('matches groups and reads citations', () => {
    expect(matches('Playwright, because Cloudflare blocked Selenium', [['playwright'], ['cloudflare', 'blocked']])).toBe(true)
    expect(matches('Playwright', [['playwright'], ['cloudflare']])).toBe(false)
    expect(citations('see [F3] and [L4, T2]; not [x]')).toEqual(['F3', 'L4', 'T2'])
  })

  it('tells correct, stale, refused, wrong and invented apart, and checks citations against the records', () => {
    const upd = probe('updated', [['digitalocean']], ['hetzner'])
    expect(score(upd, `It runs on DigitalOcean now [F${f.id}].`, mem)).toMatchObject({ outcome: 'correct', citesExist: true, citesSupport: true })
    expect(score(upd, `On Hetzner [L${l.id}].`, mem)).toMatchObject({ outcome: 'stale', citesSupport: false })
    expect(score(upd, "I don't have that.", mem).outcome).toBe('refused')
    expect(score(upd, 'On AWS [F99].', mem)).toMatchObject({ outcome: 'wrong', citesExist: false })
    const never = probe('never-said', [])
    expect(score(never, "I don't have that - you haven't told me.", mem).outcome).toBe('correct')
    expect(score(never, 'Your dog is called Max.', mem).outcome).toBe('hallucinated')
  })
})

describe('report', () => {
  it('summarizes buckets, rotations between plant and probe, and lists misses', () => {
    const mem = new Memory(':memory:')
    type TurnRow = Extract<Row, { type: 'turn' }>
    const base = { type: 'turn' as const, error: false, attempts: 1, ledgerId: 1, contextTokens: 9000, ms: 10_000, answer: 'x', text: 'x' }
    const turn = (r: Omit<TurnRow, keyof typeof base>): Row => ({ ...base, ...r })
    const rows: Row[] = [
      turn({ index: 0, kind: 'plant', plant: 'a', probe: null, sessionId: 's1', rotated: null, verdict: null }),
      turn({ index: 1, kind: 'noise', plant: null, probe: null, sessionId: 's1', rotated: '40 turns in session', verdict: null }),
      turn({ index: 2, kind: 'probe', plant: 'a', probe: { kind: 'recall', phrasing: 'direct', expect: [['x']] }, sessionId: 's2', rotated: null, verdict: { outcome: 'correct', cited: ['F1'], citesExist: true, citesSupport: true } }),
      turn({ index: 3, kind: 'probe', plant: 'a', probe: { kind: 'recall', phrasing: 'paraphrase', expect: [['x']] }, sessionId: 's2', rotated: null, verdict: { outcome: 'refused', cited: [], citesExist: true, citesSupport: false } }),
      { type: 'sleep', after: 1, days: [{ date: '2026-10-04', summary: '1 new fact', skipped: 0 }] },
    ]
    const s = summarize(rows, mem, { turns: 4, seed: 1, model: 'haiku', sleepEvery: 2 })
    expect(s).toMatchObject({ done: 4, sessions: 2, rotations: 1, rotationsBetween: { min: 1, avg: 1 }, citations: { answers: 1, citing: 100, exist: 100, support: 100 } })
    expect(s.buckets.find((b) => b.name === 'recall/direct')?.accuracy).toBe(100)
    expect(s.buckets.find((b) => b.name === 'recall/paraphrase')?.accuracy).toBe(0)
    expect(s.note).toMatch(/embeddings are worth adding/)
    const md = renderReport(s)
    expect(md).toContain('| recall/direct | 1 | **100%** |')
    expect(md).toContain('#3 recall/paraphrase (refused)')
  })
})
