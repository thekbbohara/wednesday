// Live end-to-end test against the real Claude Code CLI. Costs a few cents.
//   pnpm test:live                       (haiku by default)
//   JARVIS_LIVE_MODEL=sonnet pnpm test:live
// The conversation tail is disabled, so after rotation the fresh session can
// only know the project through Now, facts, tasks and the ledger.
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { Captain } from '../src/captain/captain.ts'
import { ClaudeRunner } from '../src/captain/runner.ts'

const live = process.env.JARVIS_LIVE === '1'

describe.skipIf(!live)('live captain', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-live-'))
  const cfg = loadConfig({ dataDir, model: process.env.JARVIS_LIVE_MODEL || 'haiku', tailMessages: 0 })
  const mem = new Memory(cfg.dbPath)
  const captain = new Captain(
    mem,
    cfg,
    new ClaudeRunner({ bin: cfg.claudeBin, model: cfg.model, cwd: dataDir, allowedTools: cfg.allowedTools, timeoutSec: 300 }),
  )
  const log = (who: string, r: { text: string; contextTokens: number; sessionId: string }) =>
    console.info(`[${who} ${r.sessionId.slice(0, 8)} ${r.contextTokens} tok]\n${r.text}\n`)

  it('a fresh session answers "what are we doing and why" from memory alone', { timeout: 900_000 }, async () => {
    const r1 = await captain.handle(
      'New project. We are building "Sunchadi", a tracker for daily gold and silver prices in Nepal. ' +
        'Decision: we scrape the FENEGOSIDA website once a day, because it publishes the official rates and the news sites just copy it late. ' +
        'First job: write the scraper. Please record all of this properly.',
    )
    log('turn1', r1)
    expect(r1.error).toBeUndefined()
    expect(mem.factsAll().length + mem.taskList().length).toBeGreaterThan(0)

    await captain.rotate('test')
    expect(mem.nowGet().text).toMatch(/sunchadi/i)
    console.info(`Now after handoff:\n${mem.nowGet().text}\n`)

    const r2 = await captain.handle('Quick check: what are we working on right now, and why that data source?')
    log('turn2', r2)
    expect(r2.sessionId).not.toBe(r1.sessionId)
    expect(r2.text).toMatch(/sunchadi/i)
    expect(r2.text).toMatch(/fenegosida/i)
    expect(r2.text).toMatch(/official/i)
    expect(r2.text).toMatch(/\[(L|F|T)\d+\]/)
  })

  it('says it does not know instead of inventing the past', { timeout: 300_000 }, async () => {
    const r = await captain.handle('What did I tell you my sister\'s name was?')
    log('turn3', r)
    expect(r.text).toMatch(/don.t have|no record|not.*(told|mentioned|recorded)|haven.t/i)
  })
})
