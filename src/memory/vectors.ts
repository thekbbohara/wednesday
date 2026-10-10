// Meaning-based recall. A small local embedding model (CPU, no paid API) turns
// facts, tasks and ledger entries into vectors kept in a sidecar file next to
// memory.db. The sidecar is a cache: deleting it only means a rebuild, and
// memory.db is never written. Search fuses the vector ranking with the FTS5
// BM25 ranking by reciprocal rank fusion (RRF); with no model or no index it
// is exactly the keyword search.
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Fact, Hit, LedgerEntry, LedgerKind, Memory, Task } from './store.ts'

export const DEFAULT_EMBED_MODEL = 'Xenova/bge-small-en-v1.5'
/** bge models want this prefix on queries (not on documents). */
const BGE_QUERY = 'Represent this sentence for searching relevant passages: '
/** Ledger kinds worth finding by meaning. Now snapshots and rotations are noise. */
export const EMBED_LEDGER_KINDS: readonly LedgerKind[] = ['owner', 'captain', 'decision', 'agent', 'task', 'fact', 'digest', 'page']
/** Long entries are embedded in windows, so a topic late in a long report is still found. */
const CHUNK_CHARS = 1200
const MAX_CHUNKS = 4
/** RRF constant: the usual 60 keeps one list from dominating on rank 1 alone. */
const RRF_K = 60
/** Cosine floor for a vector-only hit, so an unrelated query still returns nothing. */
export const MIN_SIMILARITY = 0.55

export interface Embedder {
  /** Model id; a change rebuilds the index. */
  readonly id: string
  embed(texts: string[], mode: 'query' | 'doc'): Promise<Float32Array[]>
}

export interface LocalEmbedderOptions {
  model?: string
  /** Where model files are cached (e.g. ~/.wednesday/models). */
  cacheDir: string
  /** Download the model if it is not cached. Only the indexer does; queries never wait on a download. */
  download?: boolean
  /** ONNX intra-op threads; low keeps the CPU (and the PC) cool. */
  threads?: number
}

type Extractor = (texts: string[], opts: { pooling: 'cls' | 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>

/** transformers.js on CPU. Loaded lazily; a missing package or model makes embed() throw. */
export class LocalEmbedder implements Embedder {
  readonly id: string
  private opts: LocalEmbedderOptions
  private loading: Promise<Extractor> | null = null

  constructor(opts: LocalEmbedderOptions) {
    this.opts = opts
    this.id = opts.model ?? DEFAULT_EMBED_MODEL
  }

  private load(): Promise<Extractor> {
    this.loading ??= (async () => {
      const t = await import('@huggingface/transformers')
      t.env.cacheDir = this.opts.cacheDir
      t.env.allowRemoteModels = !!this.opts.download
      t.env.allowLocalModels = true
      const threads = this.opts.threads ?? 2
      const p = await t.pipeline('feature-extraction', this.id, {
        dtype: 'q8',
        session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
      })
      return p as unknown as Extractor
    })()
    // A failed load is retried on the next call (the model may have been downloaded since).
    this.loading.catch(() => (this.loading = null))
    return this.loading
  }

  /** Start loading in the background so the first search does not pay for it. */
  warm(): void {
    this.load().catch(() => {})
  }

  async embed(texts: string[], mode: 'query' | 'doc'): Promise<Float32Array[]> {
    if (!texts.length) return []
    const p = await this.load()
    const bge = /bge/i.test(this.id)
    const input = mode === 'query' && bge ? texts.map((t) => BGE_QUERY + t) : texts
    const out = await p(input, { pooling: bge ? 'cls' : 'mean', normalize: true })
    return out.tolist().map((v) => Float32Array.from(v))
  }
}

export type DocKind = 'fact' | 'task' | 'ledger'
export interface Doc {
  /** F12, T3, L120 or L120#2 for the third window of a long entry. */
  key: string
  ref: string
  kind: DocKind
  hash: string
  text: string
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

export function factDoc(f: Fact): Doc {
  const text = `${f.subject}: ${f.body}`
  return { key: `F${f.id}`, ref: `F${f.id}`, kind: 'fact', hash: sha(text), text }
}

export function taskDoc(t: Task): Doc {
  const text = `${t.title}. ${t.goal}${t.plan ? ` Plan: ${t.plan}` : ''}${t.result ? ` Result: ${t.result}` : ''}`
  return { key: `T${t.id}`, ref: `T${t.id}`, kind: 'task', hash: sha(text), text }
}

export function ledgerDocs(e: LedgerEntry): Doc[] {
  const out: Doc[] = []
  const text = e.text.trim()
  for (let i = 0, start = 0; start < text.length && i < MAX_CHUNKS; i++, start += CHUNK_CHARS - 200) {
    const part = text.slice(start, start + CHUNK_CHARS)
    out.push({ key: i ? `L${e.id}#${i}` : `L${e.id}`, ref: `L${e.id}`, kind: 'ledger', hash: sha(part), text: part })
  }
  return out
}

function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}

function fromBlob(b: Uint8Array): Float32Array {
  // Copy: the blob's buffer may be shared or unaligned.
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** The sidecar file (e.g. ~/.wednesday/memory-vec.db). Never memory.db. */
export class VectorIndex {
  readonly db: DatabaseSync
  readonly path: string
  private cache: { version: number; rows: { key: string; ref: string; kind: DocKind; v: Float32Array }[] } | null = null

  constructor(path: string, model: string) {
    this.path = path
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vec(key TEXT PRIMARY KEY, ref TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL, v BLOB NOT NULL);`)
    if (this.metaGet('model') !== model) {
      // Vectors from another model are not comparable: start over.
      this.db.exec('DELETE FROM vec; DELETE FROM meta;')
      this.metaSet('model', model)
    }
  }

  /** An index built with this model, opened for searching; null if there is none yet. Never resets anything. */
  static openExisting(path: string, model: string): VectorIndex | null {
    if (!model || !existsSync(path)) return null
    try {
      const probe = new DatabaseSync(path, { readOnly: true })
      const row = probe.prepare("SELECT value FROM meta WHERE key = 'model'").get() as { value: string } | undefined
      probe.close()
      return row?.value === model ? new VectorIndex(path, model) : null
    } catch {
      return null
    }
  }

  close(): void {
    this.db.close()
  }

  metaGet(key: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
  }

  metaSet(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  /** Last ledger id already indexed (the ledger is append-only, so a cursor is enough). */
  get ledgerCursor(): number {
    return Number(this.metaGet('ledger_cursor') ?? 0)
  }

  hashes(kind: DocKind): Map<string, string> {
    const rows = this.db.prepare('SELECT key, hash FROM vec WHERE kind = ?').all(kind) as { key: string; hash: string }[]
    return new Map(rows.map((r) => [r.key, r.hash]))
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM vec').get() as { n: number }).n
  }

  /** Writes one batch atomically, moving the ledger cursor with it. */
  put(docs: Doc[], vecs: Float32Array[], ledgerCursor?: number): void {
    const ins = this.db.prepare('INSERT INTO vec(key, ref, kind, hash, v) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET hash = excluded.hash, v = excluded.v')
    this.db.exec('BEGIN')
    try {
      docs.forEach((d, i) => ins.run(d.key, d.ref, d.kind, d.hash, toBlob(vecs[i])))
      if (ledgerCursor !== undefined && ledgerCursor > this.ledgerCursor) this.metaSet('ledger_cursor', String(ledgerCursor))
      this.db.exec('COMMIT')
      this.cache = null
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Nearest documents by cosine (vectors are normalized), best first, one per ref. */
  search(q: Float32Array, kind: DocKind, limit: number, keep: (ref: string) => boolean = () => true): { ref: string; sim: number }[] {
    const best = new Map<string, number>()
    for (const r of this.rows()) {
      if (r.kind !== kind) continue
      const s = dot(q, r.v)
      if (s > (best.get(r.ref) ?? -1)) best.set(r.ref, s)
    }
    return [...best]
      .map(([ref, sim]) => ({ ref, sim }))
      .filter((h) => h.sim >= MIN_SIMILARITY)
      .sort((a, b) => b.sim - a.sim)
      .filter((h) => keep(h.ref))
      .slice(0, limit)
  }

  /** All vectors in memory (a few MB), reloaded only when the file changed. */
  private rows() {
    // data_version moves when another connection (the indexer process) commits; put() clears the cache for our own writes.
    const version = (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version
    if (this.cache?.version !== version) {
      const rows = this.db.prepare('SELECT key, ref, kind, v FROM vec').all() as { key: string; ref: string; kind: DocKind; v: Uint8Array }[]
      this.cache = { version, rows: rows.map((r) => ({ key: r.key, ref: r.ref, kind: r.kind, v: fromBlob(r.v) })) }
    }
    return this.cache.rows
  }
}

/** Documents that are new or changed since they were last embedded. */
export function pendingDocs(mem: Memory, idx: VectorIndex, maxLedger = Infinity): { docs: Doc[]; ledgerTo: number } {
  const docs: Doc[] = []
  for (const [kind, all] of [
    ['fact', mem.factsAll(true).map(factDoc)],
    ['task', mem.taskList({ limit: 1_000_000 }).map(taskDoc)],
  ] as const) {
    const have = idx.hashes(kind)
    for (const d of all) if (have.get(d.key) !== d.hash) docs.push(d)
  }
  const fresh = mem.ledgerSince(idx.ledgerCursor).slice(0, maxLedger === Infinity ? undefined : maxLedger)
  for (const e of fresh) if (EMBED_LEDGER_KINDS.includes(e.kind) && e.text.trim()) docs.push(...ledgerDocs(e))
  return { docs, ledgerTo: fresh.at(-1)?.id ?? idx.ledgerCursor }
}

export interface IndexResult {
  embedded: number
  ms: number
}

/**
 * Embeds what is pending, in small batches with a pause between them so a
 * long backfill never runs the CPU (or the SSD) flat out. Safe to stop at any
 * point: every batch is committed with its cursor.
 */
export async function indexPending(
  mem: Memory,
  idx: VectorIndex,
  embedder: Embedder,
  opts: { batch?: number; pauseMs?: number; log?: (s: string) => void } = {},
): Promise<IndexResult> {
  const t0 = Date.now()
  const size = opts.batch ?? 16
  const { docs, ledgerTo } = pendingDocs(mem, idx)
  // Batches hold whole entries (all windows of one ledger entry), so the cursor never splits one.
  const batches: Doc[][] = [[]]
  for (const d of docs) {
    const cur = batches.at(-1)!
    if (cur.length >= size && cur.at(-1)!.ref !== d.ref) batches.push([d])
    else cur.push(d)
  }
  let done = 0
  for (const [i, part] of batches.entries()) {
    if (!part.length) continue
    const vecs = await embedder.embed(part.map((d) => d.text), 'doc')
    const last = i === batches.length - 1
    const lastLedger = part.findLast((d) => d.kind === 'ledger')
    idx.put(part, vecs, last ? ledgerTo : lastLedger ? Number(lastLedger.ref.slice(1)) : undefined)
    done += part.length
    if (opts.log && (done % 400 < part.length || last)) opts.log(`embedded ${done}/${docs.length}`)
    if (!last && opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs))
  }
  if (!docs.length && ledgerTo > idx.ledgerCursor) idx.metaSet('ledger_cursor', String(ledgerTo))
  return { embedded: done, ms: Date.now() - t0 }
}

/** Reciprocal rank fusion of ranked ref lists. */
export function rrf(lists: string[][]): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) list.forEach((ref, i) => scores.set(ref, (scores.get(ref) ?? 0) + 1 / (RRF_K + i + 1)))
  return scores
}

export type SearchScope = 'all' | 'facts' | 'ledger' | 'tasks'

/**
 * Keyword + meaning search with the same shape as Memory.search. Each layer is
 * fused on its own, so a strong fact never pushes out the ledger. Any failure
 * of the model or the index falls back to the keyword results.
 */
export class HybridSearch {
  readonly mem: Memory
  readonly index: VectorIndex | null
  readonly embedder: Embedder | null
  private log: (s: string) => void
  private warned = false

  constructor(mem: Memory, index: VectorIndex | null, embedder: Embedder | null, log: (s: string) => void = () => {}) {
    this.mem = mem
    this.index = index
    this.embedder = embedder
    this.log = log
  }

  /** Query vector, or null when meaning search is unavailable (logged once). */
  private async queryVec(query: string): Promise<Float32Array | null> {
    if (!this.index || !this.embedder || !this.index.count()) return null
    try {
      const [v] = await this.embedder.embed([query.slice(0, 2000)], 'query')
      return v
    } catch (e) {
      if (!this.warned) this.log(`meaning search unavailable, using keywords only: ${(e as Error).message}`)
      this.warned = true
      return null
    }
  }

  async search(query: string, opts: { scope?: SearchScope; limit?: number; includeStale?: boolean } = {}): Promise<Hit[]> {
    const scope = opts.scope ?? 'all'
    const limit = opts.limit ?? 8
    const q = await this.queryVec(query)
    const out: Hit[] = []
    if (scope === 'all' || scope === 'facts') out.push(...this.facts(query, q, limit, opts.includeStale))
    if (scope === 'all' || scope === 'tasks') out.push(...this.tasks(query, q, limit))
    if (scope === 'all' || scope === 'ledger') out.push(...this.ledger(query, q, limit))
    return out
  }

  async searchFacts(query: string, limit = 8, includeStale = false): Promise<Hit[]> {
    return this.facts(query, await this.queryVec(query), limit, includeStale)
  }

  async searchLedger(query: string, limit = 8, opts: { beforeId?: number; kinds?: readonly LedgerKind[] } = {}): Promise<Hit[]> {
    return this.ledger(query, await this.queryVec(query), limit, opts)
  }

  private facts(query: string, q: Float32Array | null, limit: number, includeStale = false): Hit[] {
    const kw = this.mem.searchFacts(query, limit * 2, includeStale)
    if (!q) return kw.slice(0, limit)
    const vec = this.index!.search(q, 'fact', limit * 2, (ref) => {
      const f = this.mem.factGet(Number(ref.slice(1)))
      return !!f && (includeStale || !f.stale)
    })
    return this.fuse(kw, vec, limit, (ref) => this.mem.searchFactHit(Number(ref.slice(1))))
  }

  private tasks(query: string, q: Float32Array | null, limit: number): Hit[] {
    const kw = this.mem.searchTasks(query, limit * 2)
    if (!q) return kw.slice(0, limit)
    const vec = this.index!.search(q, 'task', limit * 2, (ref) => !!this.mem.taskGet(Number(ref.slice(1))))
    return this.fuse(kw, vec, limit, (ref) => this.mem.searchTaskHit(Number(ref.slice(1))))
  }

  private ledger(query: string, q: Float32Array | null, limit: number, opts: { beforeId?: number; kinds?: readonly LedgerKind[] } = {}): Hit[] {
    const kw = this.mem.searchLedger(query, limit * 2, opts)
    if (!q) return kw.slice(0, limit)
    const vec = this.index!.search(q, 'ledger', limit * 2, (ref) => {
      const id = Number(ref.slice(1))
      if (opts.beforeId && id >= opts.beforeId) return false
      if (!opts.kinds?.length) return true
      const e = this.mem.ledgerGet(id)
      return !!e && opts.kinds.includes(e.kind)
    })
    return this.fuse(kw, vec, limit, (ref) => this.mem.searchLedgerHit(Number(ref.slice(1))))
  }

  private fuse(kw: Hit[], vec: { ref: string; sim: number }[], limit: number, hit: (ref: string) => Hit | null): Hit[] {
    const scores = rrf([kw.map((h) => h.ref), vec.map((h) => h.ref)])
    const byRef = new Map(kw.map((h) => [h.ref, h]))
    return [...scores]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([ref, score]) => {
        const h = byRef.get(ref) ?? hit(ref)
        return h ? { ...h, score } : null
      })
      .filter((h): h is Hit => h !== null)
  }
}

/**
 * Hybrid search over a memory file and its sidecars. Missing model, missing
 * index or a load failure all mean keyword search, with one log line.
 */
export function openSearch(mem: Memory, paths: { vec: string; models: string }, model: string, log: (s: string) => void = () => {}): HybridSearch {
  const index = model ? VectorIndex.openExisting(paths.vec, model) : null
  if (!index) return new HybridSearch(mem, null, null, log)
  const embedder = new LocalEmbedder({ model, cacheDir: paths.models, download: false, threads: 2 })
  embedder.warm()
  return new HybridSearch(mem, index, embedder, log)
}
