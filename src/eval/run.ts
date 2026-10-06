#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Long-run eval: drives the real captain through hundreds of scripted turns,
// with real session rotation and nightly sleeps, and scores recall probes.
//   node src/eval/run.ts --data /tmp/majordomo-eval --turns 520 --model haiku
//   node src/eval/run.ts --data /tmp/majordomo-eval --report     (report only)
// Resumable: progress is one JSON line per turn in <data>/eval.jsonl.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.ts'
import { Memory } from '../memory/store.ts'
import { Captain } from '../captain/captain.ts'
import { buildRunner } from '../captain/chain.ts'
import { ClaudeSleepModel, runSleep, summaryLine } from '../sleep/sleep.ts'
import { buildScenario, type Turn } from './scenario.ts'
import { score, type Verdict } from './score.ts'
import { renderReport, summarize, type Row } from './report.ts'

const { values: args } = parseArgs({
  options: {
    data: { type: 'string' },
    turns: { type: 'string', default: '520' },
    seed: { type: 'string', default: '7' },
    model: { type: 'string', default: 'haiku' },
    'sleep-every': { type: 'string', default: '100' },
    plants: { type: 'string' },
    report: { type: 'boolean', default: false },
  },
})
if (!args.data) {
  console.error('usage: node src/eval/run.ts --data <dir> [--turns 520] [--model haiku] [--sleep-every 100] [--seed 7] [--report]')
  process.exit(2)
}

const cfg = loadConfig({ dataDir: args.data, model: args.model!, sleepAt: '' })
const log = join(cfg.dataDir, 'eval.jsonl')
const setupFile = join(cfg.dataDir, 'eval-setup.json')
const setup = { turns: Number(args.turns), seed: Number(args.seed), model: args.model!, sleepEvery: Number(args['sleep-every']), plants: args.plants ? Number(args.plants) : null }
const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })

// A resumed run must be the same run.
if (existsSync(setupFile)) {
  const prev = JSON.parse(readFileSync(setupFile, 'utf8')) as typeof setup
  if (!args.report && JSON.stringify(prev) !== JSON.stringify(setup)) {
    console.error(`this data dir holds a different run: ${JSON.stringify(prev)}`)
    process.exit(2)
  }
  Object.assign(setup, prev)
} else writeFileSync(setupFile, JSON.stringify(setup, null, 2))

const rows: Row[] = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row) : []
const write = (r: Row) => {
  rows.push(r)
  appendFileSync(log, `${JSON.stringify(r)}\n`)
}

function finish(): void {
  const s = summarize(rows, mem, setup)
  writeFileSync(join(cfg.dataDir, 'report.json'), JSON.stringify(s, null, 2))
  writeFileSync(join(cfg.dataDir, 'report.md'), renderReport(s))
  console.log(renderReport(s))
}

if (args.report) {
  finish()
  process.exit(0)
}

const scenario = buildScenario({ turns: setup.turns, seed: setup.seed, plants: setup.plants ?? undefined })
const captain = new Captain(mem, cfg, (p) => buildRunner(p, cfg))
const sleeper = new ClaudeSleepModel({ bin: cfg.claudeBin, model: cfg.sleepModel, promptFile: cfg.sleepPromptFile, timeoutSec: cfg.turnTimeout, cwd: cfg.dataDir, name: cfg.name, configDir: cfg.claudeConfigDir })
const done = new Set(rows.filter((r) => r.type === 'turn').map((r) => r.index))

async function turn(t: Turn): Promise<void> {
  const owner = captain.receive(t.text)
  const started = Date.now()
  // Retries reuse the same owner message, so the ledger holds it once.
  for (let attempt = 1; ; attempt++) {
    const r = await captain.respond([owner])
    if (!r.error || attempt === 3) {
      const verdict: Verdict | null = t.probe && !r.error ? score(t, r.text, mem) : null
      write({
        type: 'turn',
        index: t.index,
        kind: t.kind,
        plant: t.plant ?? null,
        probe: t.probe ?? null,
        text: t.text,
        answer: r.text,
        error: !!r.error,
        attempts: attempt,
        ledgerId: r.ledgerId,
        sessionId: r.sessionId,
        contextTokens: r.contextTokens,
        rotated: r.rotated ?? null,
        ms: Date.now() - started,
        verdict,
      })
      const mark = verdict ? ` ${verdict.outcome}${verdict.cited.length ? ` cites ${verdict.cited.join(',')}` : ''}` : r.error ? ' ERROR' : ''
      console.log(`[${t.index + 1}/${setup.turns}] ${t.kind}${t.probe ? `/${t.probe.kind}/${t.probe.phrasing}` : ''} ${r.contextTokens} tok${r.rotated ? ' (rotated)' : ''}${mark}`)
      return
    }
    await new Promise((res) => setTimeout(res, 15_000 * attempt))
  }
}

for (const t of scenario) {
  if (done.has(t.index)) continue
  await turn(t)
  if ((t.index + 1) % setup.sleepEvery === 0 && t.index + 1 < setup.turns) {
    try {
      const s = await runSleep(mem, sleeper)
      write({ type: 'sleep', after: t.index, days: s.days.map((d) => ({ date: d.date, summary: summaryLine(d), skipped: d.skipped.length })) })
      console.log(`sleep after turn ${t.index + 1}: ${s.days.map((d) => summaryLine(d)).join('; ') || 'nothing new'}`)
    } catch (e) {
      write({ type: 'sleep', after: t.index, error: (e as Error).message })
      console.log(`sleep failed: ${(e as Error).message}`)
    }
  }
}
finish()
mem.close()
