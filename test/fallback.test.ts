// A missing or broken embedding model must mean keyword search, never a crash:
// no rejected promise may go unhandled, because that would take the server down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, sidecars } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { DEFAULT_EMBED_MODEL, HybridSearch, indexPending, LocalEmbedder, openSearch, VectorIndex, type Embedder } from '../src/memory/vectors.ts'
import { startIndexer } from '../src/memory/indexer.ts'
import { startExtractSchedule, startSleepSchedule } from '../src/sleep/schedule.ts'

const unhandled: unknown[] = []
const onRejection = (e: unknown) => unhandled.push(e)
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms))

beforeAll(() => {
  process.on('unhandledRejection', onRejection)
})
afterAll(() => {
  process.off('unhandledRejection', onRejection)
})

/** Stands in for the real model when building the index; same id, so the index is "for" the real model. */
const stub: Embedder = { id: DEFAULT_EMBED_MODEL, embed: async (t) => t.map(() => Float32Array.from({ length: 4 }, () => 0.5)) }

describe('model missing', () => {
  it('falls back to keyword search, logs once, and leaves no unhandled rejection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wed-nomodel-'))
    const mem = new Memory(join(dir, 'memory.db'))
    mem.append('owner', 'the pc crashed again')
    const paths = sidecars(mem.path)
    // An index exists, but models/ is empty and downloads are off (offline).
    const idx = new VectorIndex(paths.vec, DEFAULT_EMBED_MODEL)
    await indexPending(mem, idx, stub)
    idx.close()

    const logs: string[] = []
    const search = openSearch(mem, paths, DEFAULT_EMBED_MODEL, (s) => logs.push(s))
    expect(search.index).not.toBeNull()
    // openSearch already started warm(); its failure must be handled.
    expect((await search.search('crashed')).map((h) => h.ref)).toEqual(['L1'])
    expect((await search.searchLedger('crashed')).map((h) => h.ref)).toEqual(['L1'])
    expect(await search.searchFacts('crashed')).toEqual([])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/keywords only/)
    await tick()
    expect(unhandled).toEqual([])
  })

  it('a bare LocalEmbedder rejects to its caller only, and retries the load next time', async () => {
    const emb = new LocalEmbedder({ cacheDir: mkdtempSync(join(tmpdir(), 'wed-empty-')), download: false })
    emb.warm()
    await expect(emb.embed(['x'], 'query')).rejects.toThrow()
    await expect(emb.embed(['y'], 'query')).rejects.toThrow()
    await tick()
    expect(unhandled).toEqual([])
  })

  it('an embedder that throws synchronously-ish is still keyword search', async () => {
    const mem = new Memory(':memory:')
    mem.append('owner', 'crash report')
    const idx = new VectorIndex(':memory:', 'x')
    await indexPending(mem, idx, { id: 'x', embed: async (t) => t.map(() => new Float32Array([1, 0])) })
    const broken: Embedder = {
      id: 'x',
      embed: () => {
        throw new Error('boom')
      },
    }
    expect((await new HybridSearch(mem, idx, broken).search('crash')).map((h) => h.ref)).toEqual(['L1'])
    expect(unhandled).toEqual([])
  })
})

describe('background timers never crash the server', () => {
  const broken = () => {
    const mem = new Memory(':memory:')
    mem.close() // every call now throws
    return mem
  }

  it('extract, sleep and indexer ticks log the failure instead of throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wed-timers-'))
    const cfg = loadConfig({ dataDir: dir, extractEvery: 1, sleepAt: '00:00' })
    const logs: string[] = []
    const model = { consolidate: async () => ({ add: [], supersede: [], stale: [], merge: [], digest: '' }) }
    // Indexer: an existing sidecar so the tick reads memory (and fails).
    new VectorIndex(sidecars(cfg.dbPath).vec, cfg.embedModel).close()
    const stops = [
      startExtractSchedule(broken(), cfg, model, (s) => logs.push(s), 10),
      startSleepSchedule(broken(), cfg, model, (s) => logs.push(s)),
      startIndexer(broken(), cfg, (s) => logs.push(s), 10),
    ]
    try {
      for (let i = 0; i < 100 && !(logs.some((l) => /extract tick failed/.test(l)) && logs.some((l) => /sleep tick failed/.test(l)) && logs.some((l) => /indexer check failed/.test(l))); i++) await tick(20)
    } finally {
      stops.forEach((s) => s())
    }
    expect(logs.some((l) => /extract tick failed/.test(l))).toBe(true)
    expect(logs.some((l) => /sleep tick failed/.test(l))).toBe(true)
    expect(logs.some((l) => /indexer check failed/.test(l))).toBe(true)
    expect(unhandled).toEqual([])
  })
})
