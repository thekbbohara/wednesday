import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory } from '../src/memory/store.ts'
import { sidecars } from '../src/config.ts'
import { HybridSearch, indexPending, ledgerDocs, openSearch, pendingDocs, rrf, VectorIndex, type Embedder } from '../src/memory/vectors.ts'

// Words in one group mean the same thing; other words land in hashed buckets of their own.
const GROUPS = [['crash', 'crashes', 'crashing', 'freeze', 'freezes', 'froze', 'hang'], ['instagram', 'ig', 'reel'], ['ssd', 'nvme', 'disk']]
const DIM = GROUPS.length + 64

class FakeEmbedder implements Embedder {
  readonly id: string
  calls: string[][] = []
  fail = false
  constructor(id = 'fake-1') {
    this.id = id
  }
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.fail) throw new Error('model not found')
    this.calls.push(texts)
    return texts.map((t) => {
      const v = new Float32Array(DIM)
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        const g = GROUPS.findIndex((grp) => grp.includes(w))
        if (g >= 0) v[g] += 3
        else v[GROUPS.length + ([...w].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 64)] += 1
      }
      const n = Math.hypot(...v) || 1
      return v.map((x) => x / n)
    })
  }
}

const setup = () => {
  const mem = new Memory(':memory:')
  const idx = new VectorIndex(':memory:', 'fake-1')
  const emb = new FakeEmbedder()
  return { mem, idx, emb, search: new HybridSearch(mem, idx, emb) }
}

describe('vector index', () => {
  it('indexes incrementally: new ledger entries, new facts and changed tasks only', async () => {
    const { mem, idx, emb } = setup()
    mem.append('owner', 'the pc froze again')
    mem.append('now', 'Now v1: a long note that is not worth embedding')
    const t = mem.taskCreate({ title: 'fix disk', goal: 'stop the ssd overheating' })
    const first = await indexPending(mem, idx, emb)
    // L1 owner, L3 task-created entry, T1; Now (L2) is skipped.
    expect(first.embedded).toBe(3)
    expect(idx.ledgerCursor).toBe(3)
    expect((await indexPending(mem, idx, emb)).embedded).toBe(0)

    mem.taskUpdate(t.id, { result: 'replaced the heatsink' })
    mem.factWrite({ kind: 'project', subject: 'pc', body: 'nvme runs hot', source: 'L1' })
    const keys = pendingDocs(mem, idx).docs.map((d) => d.key)
    expect(keys).toEqual(['F1', 'T1', 'L4', 'L5'])
  })

  it('skips agent plumbing (started, stopped, menu answers) but keeps reports and messages', async () => {
    const { mem, idx } = setup()
    mem.append('agent', 'clipcrew2 stopped', { meta: { agent: 'clipcrew2', event: 'stop' } })
    mem.append('agent', 'The owner answered x: yes', { meta: { agent: 'x', event: 'answer' } })
    mem.append('agent', 'x reported: the pc froze during the render', { meta: { agent: 'x', event: 'report' } })
    mem.append('agent', 'Wednesday to x: retry on the other disk', { meta: { agent: 'x', event: 'message' } })
    expect(pendingDocs(mem, idx).docs.map((d) => d.key)).toEqual(['L3', 'L4'])
  })

  it('splits long entries into windows that resolve to one ref', () => {
    const docs = ledgerDocs({ id: 9, ts: '', kind: 'agent', session: null, text: 'word '.repeat(1000), meta: null })
    expect(docs.length).toBeGreaterThan(1)
    expect(docs.length).toBeLessThanOrEqual(4)
    expect(new Set(docs.map((d) => d.ref))).toEqual(new Set(['L9']))
    expect(docs[1].key).toBe('L9#1')
  })

  it('starts over when the model changes, and openExisting never resets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wed-vec-'))
    const path = join(dir, 'memory-vec.db')
    const mem = new Memory(':memory:')
    mem.append('owner', 'hello')
    const a = new VectorIndex(path, 'fake-1')
    await indexPending(mem, a, new FakeEmbedder())
    a.close()
    expect(VectorIndex.openExisting(path, 'other-model')).toBeNull()
    const kept = VectorIndex.openExisting(path, 'fake-1')!
    expect(kept.count()).toBe(1)
    kept.close()
    const b = new VectorIndex(path, 'other-model')
    expect(b.count()).toBe(0)
    expect(b.ledgerCursor).toBe(0)
  })

  it('reads memory.db read-only and writes only the sidecar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wed-ro-'))
    const db = join(dir, 'memory.db')
    const w = new Memory(db)
    w.append('owner', 'the pc keeps freezing')
    w.close()
    const before = statSync(db).mtimeMs
    const ro = new Memory(db, { readOnly: true })
    expect(() => ro.append('owner', 'x')).toThrow()
    const idx = new VectorIndex(sidecars(db).vec, 'fake-1')
    await indexPending(ro, idx, new FakeEmbedder())
    expect(idx.count()).toBe(1)
    expect(statSync(db).mtimeMs).toBe(before)
    expect(existsSync(join(dir, 'memory-vec.db'))).toBe(true)
  })
})

describe('hybrid search', () => {
  it('finds by meaning what keywords miss ("crash" finds "freeze")', async () => {
    const { mem, idx, emb, search } = setup()
    mem.append('owner', 'my pc froze twice today under load')
    mem.append('owner', 'lunch was good')
    mem.factWrite({ kind: 'project', subject: 'pc hard freezes', body: 'the machine freezes when the nvme gets hot', source: 'L1' })
    await indexPending(mem, idx, emb)
    expect(mem.search('crash', { scope: 'ledger' })).toEqual([])
    const hits = await search.search('crash')
    const refs = hits.map((h) => h.ref)
    expect(refs).toContain('L1')
    expect(refs).toContain('F1')
    expect(refs).not.toContain('L2')
  })

  it('ranks a hit found both ways above one found one way', async () => {
    const { mem, idx, emb, search } = setup()
    mem.append('owner', 'pc crash after update')
    mem.append('owner', 'pc froze overnight')
    await indexPending(mem, idx, emb)
    const hits = await search.searchLedger('crash')
    expect(hits[0].ref).toBe('L1')
    expect(hits.map((h) => h.ref)).toContain('L2')
  })

  it('returns nothing for an unrelated query', async () => {
    const { mem, idx, emb, search } = setup()
    mem.append('owner', 'my pc froze')
    await indexPending(mem, idx, emb)
    expect(await search.search('quarterly taxes')).toEqual([])
  })

  it('keeps the filters: stale facts, beforeId and kinds', async () => {
    const { mem, idx, emb, search } = setup()
    const f = mem.factWrite({ kind: 'project', subject: 'pc', body: 'it froze', source: 'owner' })
    mem.factMarkStale(f.id, 'fixed')
    mem.append('captain', 'the pc froze')
    await indexPending(mem, idx, emb)
    expect((await search.searchFacts('crash')).map((h) => h.ref)).toEqual([])
    expect((await search.searchFacts('crash', 8, true)).map((h) => h.ref)).toEqual(['F1'])
    const last = mem.lastLedgerId()
    expect((await search.searchLedger('crash', 8, { beforeId: last })).map((h) => h.ref)).not.toContain(`L${last}`)
    expect((await search.searchLedger('crash', 8, { kinds: ['owner'] })).map((h) => h.ref)).not.toContain(`L${last}`)
  })

  it('falls back to keywords when the model fails, and logs it once', async () => {
    const { mem, idx, emb } = setup()
    mem.append('owner', 'my pc froze')
    mem.append('owner', 'crash report attached')
    await indexPending(mem, idx, emb)
    emb.fail = true
    const logs: string[] = []
    const search = new HybridSearch(mem, idx, emb, (s) => logs.push(s))
    expect((await search.search('crash')).map((h) => h.ref)).toEqual(['L2'])
    await search.search('crash')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/keywords only/)
  })

  it('openSearch without an index is keyword search', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wed-open-'))
    const mem = new Memory(join(dir, 'memory.db'))
    mem.append('owner', 'crash report')
    const s = openSearch(mem, sidecars(mem.path), 'Xenova/all-MiniLM-L6-v2')
    expect(s.index).toBeNull()
    expect((await s.search('crash')).map((h) => h.ref)).toEqual(['L1'])
    expect(openSearch(mem, sidecars(mem.path), '').index).toBeNull()
  })

  it('fuses rankings with RRF', () => {
    const s = rrf([['A', 'B'], ['B', 'C']])
    expect([...s].sort((a, b) => b[1] - a[1])[0][0]).toBe('B')
    expect(s.get('A')).toBeCloseTo(1 / 61)
  })
})
