// Keeps memory-vec.db current from inside the server: when something is
// waiting to be embedded, it runs embed-index.ts as a child process at the
// lowest CPU and I/O priority, one at a time. The PC's SSD overheats under
// long heavy load, so the work is niced, throttled and done in small batches.
import { spawn, spawnSync } from 'node:child_process'
import { setPriority } from 'node:os'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { sidecars, type Config } from '../config.ts'
import type { Memory } from './store.ts'
import { pendingDocs, VectorIndex } from './vectors.ts'

const SCRIPT = fileURLToPath(new URL('./embed-index.ts', import.meta.url))
const RETRY_MS = 30 * 60_000

/** Lowest scheduling priority for a running child; best effort on each knob. */
export function deprioritize(pid: number): void {
  try {
    setPriority(pid, 19)
  } catch {}
  try {
    spawnSync('ionice', ['-c', '3', '-p', String(pid)], { stdio: 'ignore', timeout: 2000 })
  } catch {}
}

export function startIndexer(mem: Memory, cfg: Config, log = console.log, everyMs = 2 * 60_000): () => void {
  let running = false
  let retryAt = 0
  const tick = () => {
    // cfg.embedModel is read each time, so turning it off applies without a restart.
    if (running || !cfg.embedModel || Date.now() < retryAt) return
    const paths = sidecars(cfg.dbPath)
    if (existsSync(paths.vec)) {
      const idx = new VectorIndex(paths.vec, cfg.embedModel)
      try {
        if (!pendingDocs(mem, idx).docs.length) return
      } finally {
        idx.close()
      }
    }
    running = true
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT, cfg.dbPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WEDNESDAY_EMBED_MODEL: cfg.embedModel },
    })
    if (child.pid) deprioritize(child.pid)
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      for (const line of String(d).split('\n')) if (line.trim()) log(`embed: ${line.trim()}`)
    })
    child.stderr.on('data', (d: Buffer) => (err = (err + d).slice(-600)))
    child.on('close', (code) => {
      running = false
      if (code !== 0) {
        retryAt = Date.now() + RETRY_MS
        log(`embed: indexer failed (exit ${code}); keyword search still works, retrying in 30 min. ${err.trim().split('\n').at(-1) ?? ''}`)
      }
    })
    child.on('error', () => (running = false))
  }
  const first = setTimeout(tick, 30_000)
  const timer = setInterval(tick, everyMs)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
