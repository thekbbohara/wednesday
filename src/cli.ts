#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Terminal chat with the captain.
//   jarvis                 interactive chat
//   jarvis ask "message"   one turn, print the reply
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { Memory } from './memory/store.ts'
import { Captain, type Reply } from './captain/captain.ts'
import { buildRunner } from './captain/chain.ts'

const cfg = loadConfig()
mkdirSync(cfg.dataDir, { recursive: true })
const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })
const captain = new Captain(mem, cfg, (p) => buildRunner(p, cfg))

const tty = stdout.isTTY
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)

function status(r: Reply): string {
  const pct = r.contextWindow ? ` ${Math.round((100 * r.contextTokens) / r.contextWindow)}% ctx` : ''
  return dim(`[L${r.ledgerId}${pct}${r.rotated ? ` - session rotated: ${r.rotated}` : ''}]`)
}

const HELP = `/now  /tasks  /facts  /search <words>  /get <F1|T1|L1>  /rotate  /sessions  /help  /quit`

async function command(line: string): Promise<boolean> {
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
    console.error('usage: jarvis ask "message"')
    process.exit(2)
  }
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
