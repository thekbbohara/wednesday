// Runs the sleep once a day at a local time, inside the server, so a Docker
// deployment needs no cron. It holds the captain's turn lock while it works.
import { join } from 'node:path'
import type { Config } from '../config.ts'
import type { Memory } from '../memory/store.ts'
import { withFileLock } from '../captain/lock.ts'
import { localDay, runSleep, summaryLine, type SleepModel, type SleepResult } from './sleep.ts'

const LAST = 'sleep_last_date'
const RETRY_MS = 30 * 60_000

/** True when today's slot has passed and today's sleep has not run yet. */
export function due(at: string, lastDate: string | null, now: Date): boolean {
  if (!at) return false
  const [h, m] = at.split(':').map(Number)
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  return now >= slot && lastDate !== localDay(now.toISOString())
}

export async function sleepNow(mem: Memory, cfg: Config, model: SleepModel, opts: { dryRun?: boolean } = {}): Promise<SleepResult> {
  return withFileLock(join(cfg.dataDir, 'captain.lock'), (cfg.turnTimeout + 120) * 1000, () => runSleep(mem, model, opts))
}

export function startSleepSchedule(mem: Memory, cfg: Config, model: SleepModel, log = console.log): () => void {
  if (!cfg.sleepAt) return () => {}
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
