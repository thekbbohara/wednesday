// Runs the sleep once a day at a local time, inside the server, so a Docker
// deployment needs no cron. It holds the captain's turn lock while it works.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../config.ts'
import type { Memory } from '../memory/store.ts'
import { withFileLock } from '../captain/lock.ts'
import { extractPending, localDay, runExtract, runSleep, summaryLine, type ExtractResult, type SleepModel, type SleepResult } from './sleep.ts'

const LAST = 'sleep_last_date'
const RETRY_MS = 30 * 60_000

/** True when today's slot has passed and today's sleep has not run yet. */
export function due(at: string, lastDate: string | null, now: Date): boolean {
  if (!at) return false
  const [h, m] = at.split(':').map(Number)
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  return now >= slot && lastDate !== localDay(now.toISOString())
}

/** Held by the nightly sleep and the quick pass, so they never consolidate at the same time. */
const consolidateLock = (cfg: Config) => join(cfg.dataDir, 'consolidate.lock')

export async function sleepNow(mem: Memory, cfg: Config, model: SleepModel, opts: { dryRun?: boolean } = {}): Promise<SleepResult> {
  return withFileLock(consolidateLock(cfg), (cfg.turnTimeout + 120) * 1000, () =>
    withFileLock(join(cfg.dataDir, 'captain.lock'), (cfg.turnTimeout + 120) * 1000, () => runSleep(mem, model, opts)),
  )
}

/** True when enough conversation is waiting, or the oldest waiting entry is old enough. */
export function extractDue(pending: { count: number; oldest: string | null }, every: number, minutes: number, now: Date): boolean {
  if (every <= 0 || !pending.count) return false
  if (pending.count >= every) return true
  return minutes > 0 && !!pending.oldest && now.getTime() - new Date(pending.oldest).getTime() >= minutes * 60_000
}

export function extractLine(r: ExtractResult): string {
  if (!r.entries) return 'extract: nothing new'
  const cost = `${r.calls} ${r.calls === 1 ? 'call' : 'calls'}, ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens, $${r.usage.costUsd.toFixed(4)}, ${(r.usage.ms / 1000).toFixed(1)}s`
  return `extract: L${r.from}-L${r.to} (${r.entries} entries): ${summaryLine(r)}${r.skipped.length ? ` (${r.skipped.length} refused)` : ''}; ${cost}`
}

/**
 * The quick fact pass between sleeps. It does not take the captain's turn
 * lock (facts are small transactional writes), so the owner never waits on it.
 * Every run is logged to the console and to <data>/logs/extract.jsonl.
 */
export function startExtractSchedule(mem: Memory, cfg: Config, model: SleepModel, log = console.log, everyMs = 60_000): () => void {
  let running = false
  let retryAt = 0
  const tick = async () => {
    if (running || Date.now() < retryAt || !extractDue(extractPending(mem), cfg.extractEvery, cfg.extractMinutes, new Date())) return
    running = true
    try {
      const r = await withFileLock(consolidateLock(cfg), 1000, () => runExtract(mem, model))
      log(extractLine(r))
      try {
        mkdirSync(join(cfg.dataDir, 'logs'), { recursive: true })
        appendFileSync(join(cfg.dataDir, 'logs', 'extract.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n')
      } catch {}
    } catch (e) {
      const msg = (e as Error).message
      // The nightly sleep holds the lock: just try again next tick.
      if (!/busy/.test(msg)) {
        retryAt = Date.now() + RETRY_MS
        log(`extract failed, retrying in 30 min: ${msg}`)
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), everyMs)
  return () => clearInterval(timer)
}

export function startSleepSchedule(mem: Memory, cfg: Config, model: SleepModel, log = console.log): () => void {
  // cfg.sleepAt is read on every tick: Settings can turn the sleep on, off or move it.
  let running = false
  let retryAt = 0
  const tick = async () => {
    const now = new Date()
    if (running || Date.now() < retryAt || !due(cfg.sleepAt, mem.metaGet(LAST), now)) return
    running = true
    try {
      const r = await sleepNow(mem, cfg, model)
      mem.metaSet(LAST, localDay(now.toISOString()))
      log(`sleep: ${r.days.length ? r.days.map((d) => `${d.date} ${summaryLine(d)}${d.skipped.length ? ` (${d.skipped.length} refused)` : ''}`).join('; ') : 'nothing new'}`)
    } catch (e) {
      retryAt = Date.now() + RETRY_MS
      log(`sleep failed, retrying in 30 min: ${(e as Error).message}`)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), 60_000)
  void tick()
  return () => clearInterval(timer)
}
