#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Run the nightly sleep by hand:
//   node src/sleep.ts            consolidate everything since the last sleep
//   node src/sleep.ts --dry-run  show what it would change, change nothing
import { loadConfig } from './config.ts'
import { Memory } from './memory/store.ts'
import { ClaudeSleepModel, summaryLine } from './sleep/sleep.ts'
import { sleepNow } from './sleep/schedule.ts'

const dryRun = process.argv.includes('--dry-run')
const cfg = loadConfig()
const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })
const model = new ClaudeSleepModel({ bin: cfg.claudeBin, model: cfg.sleepModel, promptFile: cfg.sleepPromptFile, timeoutSec: cfg.turnTimeout, cwd: cfg.dataDir })
const r = await sleepNow(mem, cfg, model, { dryRun })
if (!r.days.length) console.log('Nothing new since the last sleep.')
for (const d of r.days) {
  console.log(`${d.date} (L${d.from}-L${d.to}): ${summaryLine(d)}${dryRun ? ' [dry run, nothing applied]' : ''}`)
  if (d.digest) console.log(`  ${d.digest.replace(/\n/g, '\n  ')}`)
  for (const s of d.skipped) console.log(`  refused: ${s}`)
}
if (dryRun) console.log(JSON.stringify(r.proposals, null, 2))
mem.close()
