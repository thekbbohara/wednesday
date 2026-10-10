#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Brings the meaning-search index (memory-vec.db) up to date, then exits.
// memory.db is opened read-only. The server runs this at low priority on its
// own; by hand (first backfill, or after deleting memory-vec.db):
//   nice -n 19 ionice -c 3 node src/memory/embed-index.ts [path/to/memory.db]
import { loadConfig, sidecars } from '../config.ts'
import { loadSettings } from '../settings.ts'
import { Memory } from './store.ts'
import { indexPending, LocalEmbedder, VectorIndex } from './vectors.ts'

const cfg = loadConfig()
loadSettings(cfg)
const db = process.argv[2] || cfg.dbPath
if (!cfg.embedModel) {
  console.log('meaning search is off (WEDNESDAY_EMBED_MODEL=off); nothing to index')
  process.exit(0)
}
const paths = sidecars(db)
const mem = new Memory(db, { readOnly: true })
const idx = new VectorIndex(paths.vec, cfg.embedModel)
const embedder = new LocalEmbedder({ model: cfg.embedModel, cacheDir: paths.models, download: true, threads: Number(process.env.WEDNESDAY_EMBED_THREADS) || 2 })
try {
  const r = await indexPending(mem, idx, embedder, { batch: 16, pauseMs: 150, log: (s) => console.log(s) })
  console.log(`index up to date: ${r.embedded} embedded in ${(r.ms / 1000).toFixed(1)}s, ${idx.count()} vectors, ledger through L${idx.ledgerCursor}`)
} finally {
  idx.close()
  mem.close()
}
