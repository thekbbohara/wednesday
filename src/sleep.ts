#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Run the nightly sleep by hand:
//   node src/sleep.ts            consolidate everything since the last sleep
//   node src/sleep.ts --dry-run  show what it would change, change nothing
//   node src/sleep.ts --extract  the quick daytime pass: facts from what is new, no digest
import { loadConfig } from './config.ts'
import { loadSettings } from './settings.ts'
import { Memory } from './memory/store.ts'
import { ClaudeSleepModel, summaryLine } from './sleep/sleep.ts'
import { extractLine, sleepNow } from './sleep/schedule.ts'
import { runExtract } from './sleep/sleep.ts'

const dryRun = process.argv.includes('--dry-run')
const cfg = loadConfig()
loadSettings(cfg)
const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })
const model = new ClaudeSleepModel({ bin: cfg.claudeBin, model: cfg.sleepModel, promptFile: cfg.sleepPromptFile, timeoutSec: cfg.turnTimeout, cwd: cfg.dataDir, name: cfg.name, configDir: cfg.claudeConfigDir })
if (process.argv.includes('--extract')) {
  console.log(extractLine(await runExtract(mem, model)))
  mem.close()
  process.exit(0)
}
const r = await sleepNow(mem, cfg, model, { dryRun })
if (!r.days.length) console.log('Nothing new since the last sleep.')
for (const d of r.days) {
  console.log(`${d.date} (L${d.from}-L${d.to}): ${summaryLine(d)}${dryRun ? ' [dry run, nothing applied]' : ''}`)
  if (d.digest) console.log(`  ${d.digest.replace(/\n/g, '\n  ')}`)
  for (const s of d.skipped) console.log(`  refused: ${s}`)
}
if (dryRun) console.log(JSON.stringify(r.proposals, null, 2))
mem.close()
