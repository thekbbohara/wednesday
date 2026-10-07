#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Terminal chat with the captain.
//   majordomo                 interactive chat
//   majordomo ask "message"   one turn, print the reply
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { Memory } from './memory/store.ts'
import { Captain, type Reply } from './captain/captain.ts'
import { buildRunner } from './captain/chain.ts'

import { Credits } from './credits.ts'
import { isUsageCommand, validUsageCommand, usageReport } from './credits-command.ts'
import { loadSettings, parseEngineCommand, apply, saveSettings } from './settings.ts'

const cfg = loadConfig()
mkdirSync(cfg.dataDir, { recursive: true })
loadSettings(cfg)
const credits = new Credits()
const quotaReply = async (text: string) => validUsageCommand(text) ? usageReport((await credits.read(cfg)).accounts) : 'Usage: /usages (alias /usage).'
// Quota-only asks do not open the database, create sessions, or invoke the captain.
if (process.argv[2] === 'ask' && isUsageCommand(process.argv.slice(3).join(' '))) {
  console.log(await quotaReply(process.argv.slice(3).join(' ')))
  process.exit(0)
}
const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })
const captain = new Captain(mem, cfg, (p) => buildRunner(p, cfg))

const tty = stdout.isTTY
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)

function status(r: Reply): string {
  const pct = r.contextWindow ? ` ${Math.round((100 * r.contextTokens) / r.contextWindow)}% ctx` : ''
  return dim(`[L${r.ledgerId}${pct}${r.rotated ? ` - session rotated: ${r.rotated}` : ''}]`)
}

const HELP = `/usages (/usage)  /now  /tasks  /facts  /search <words>  /get <F1|T1|L1>  /rotate  /sessions  /engine [claude|codex|kimi|agy] [model]  /help  /quit`

async function command(line: string): Promise<boolean> {
  if (isUsageCommand(line)) { console.log(await quotaReply(line)); return true }
  try {
    const engine = parseEngineCommand(line)
    if (engine) {
      apply(cfg, engine)
      if (Object.keys(engine).length) saveSettings(cfg)
      console.log(`Captain engine: ${cfg.engine}${cfg.engineModel ? ` (${cfg.engineModel})` : ''}`)
      return true
    }
  } catch (e) { console.log((e as Error).message); return true }
  const [cmd, ...rest] = line.slice(1).split(/\s+/)
  const arg = rest.join(' ')
  switch (cmd) {
    case 'quit':
    case 'exit':
      return false
    case 'now': {
      const n = mem.nowGet()
      console.log(n.version ? `${dim(`v${n.version} ${n.updated_at}`)}\n${n.text}` : '(empty)')
      break
    }
    case 'tasks':
      for (const t of mem.taskList({ limit: 30 })) console.log(`T${t.id} [${t.status}] ${t.title}`)
      break
    case 'facts':
      for (const f of mem.factsAll()) console.log(`F${f.id} [${f.kind}] ${f.subject}: ${f.body}`)
      break
    case 'search':
      for (const h of mem.search(arg)) console.log(`${h.ref} ${h.title}: ${h.text}`)
      break
    case 'get':
      console.log(JSON.stringify(mem.get(arg), null, 2))
      break
    case 'rotate':
      await captain.rotate('manual')
      console.log(dim('session rotated'))
      break
    case 'sessions':
      for (const s of mem.sessions())
        console.log(`${s.id.slice(0, 8)} ${s.started_at.slice(0, 16)} turns=${s.turns} peak=${s.peak_tokens} ${s.end_reason ?? 'live'}`)
      break
    default:
      console.log(HELP)
  }
  return true
}

if (process.argv[2] === 'ask') {
  const text = process.argv.slice(3).join(' ').trim()
  if (!text) {
    console.error('usage: majordomo ask "message"')
    process.exit(2)
  }
  if (/^\/engine(?:\s|$)/.test(text)) { await command(text); mem.close(); process.exit(0) }
  const r = await captain.handle(text)
  console.log(r.text)
  console.error(status(r))
  mem.close()
  process.exit(r.error ? 1 : 0)
}

console.log(dim(`${cfg.name} - memory ${cfg.dbPath} - model ${cfg.model} - ${HELP}`))
const rl = createInterface({ input: stdin, output: stdout, prompt: bold('you> ') })
// The async iterator buffers lines typed or pasted while a turn is running; question() would drop them.
try {
  rl.prompt()
  for await (const raw of rl) {
    const line = raw.trim()
    if (!tty && line) console.log(line)
    if (line.startsWith('/')) {
      if (!(await command(line))) break
    } else if (line) {
      const r = await captain.handle(line)
      console.log(`${bold(`${cfg.name.toLowerCase()}>`)} ${r.text}\n${status(r)}`)
    }
    rl.prompt()
  }
} finally {
  rl.close()
  mem.close()
}
