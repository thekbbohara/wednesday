#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Project pages by hand:
//   node src/pages.ts list
//   node src/pages.ts show <slug>
//   node src/pages.ts seed <slug> "<title>" "kw1,kw2,..." [--dry-run]
//       writes the first version from memory, with the sleep model
import { loadConfig, sidecars } from './config.ts'
import { loadSettings } from './settings.ts'
import { Memory } from './memory/store.ts'
import { fmtPage, Pages } from './memory/pages.ts'
import { openSearch } from './memory/vectors.ts'
import { ClaudeSleepModel } from './sleep/sleep.ts'
import { seedPage } from './sleep/seed.ts'

const cfg = loadConfig()
loadSettings(cfg)
const db = process.env.WEDNESDAY_DB || cfg.dbPath
const mem = new Memory(db, { nowBudgetChars: cfg.nowBudgetChars })
const pages = new Pages(sidecars(db).pages)
const [cmd, slug, title, keywords] = process.argv.slice(2).filter((a) => !a.startsWith('--'))

if (cmd === 'list') {
  const all = pages.list()
  console.log(all.length ? all.map((p) => `${p.slug} v${p.version} ${p.updated_at.slice(0, 16)} ${p.title} [${p.keywords.join(', ')}]`).join('\n') : 'No pages yet.')
} else if (cmd === 'show' && slug) {
  const p = pages.get(slug)
  console.log(p ? fmtPage(p) : `No page ${slug}.`)
} else if (cmd === 'seed' && slug && title && keywords) {
  const search = openSearch(mem, sidecars(db), cfg.embedModel, (s) => console.error(s))
  const model = new ClaudeSleepModel({ bin: cfg.claudeBin, model: cfg.sleepModel, promptFile: cfg.sleepPromptFile, timeoutSec: cfg.turnTimeout, cwd: cfg.dataDir, name: cfg.name, configDir: cfg.claudeConfigDir })
  const r = await seedPage(mem, pages, search, model, { slug, title, keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) }, { dryRun: process.argv.includes('--dry-run') })
  if (r.page) console.log(fmtPage(r.page))
  else if (r.body) console.log(`${r.error ? `refused: ${r.error}\n` : '[dry run]\n'}${r.body}`)
  else console.log(`no page: ${r.error}`)
  if (r.usage) console.log(`cost: $${r.usage.costUsd.toFixed(4)}, ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens, ${(r.usage.ms / 1000).toFixed(1)}s`)
} else {
  console.log('usage: node src/pages.ts list | show <slug> | seed <slug> "<title>" "kw1,kw2" [--dry-run]')
  process.exitCode = 2
}
pages.close()
mem.close()
