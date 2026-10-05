import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { apply, check, loadSettings, parseEngineCommand, saveSettings } from '../src/settings.ts'
import { parseChain, selectedChain } from '../src/captain/provider.ts'
import { createApp } from '../src/server.ts'
import { Memory } from '../src/memory/store.ts'
import type { TurnRequest, TurnResult } from '../src/captain/runner.ts'

const result: TurnResult = { text: 'hello', isError: false, contextTokens: 0, contextWindow: null, costUsd: 0 }
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 300 && !fn(); i++) await new Promise((r) => setTimeout(r, 10))
  expect(fn()).toBe(true)
}

describe('captain engine', () => {
  it('parses query, engine and optional model, rejecting invalid commands', () => {
    expect(parseEngineCommand('/engine')).toEqual({})
    expect(parseEngineCommand('/engine kimi')).toEqual({ engine: 'kimi', engineModel: '' })
    expect(parseEngineCommand('/engine codex gpt-5')).toEqual({ engine: 'codex', engineModel: 'gpt-5' })
    expect(parseEngineCommand('/engineering')).toBeNull()
    expect(() => parseEngineCommand('/engine nope')).toThrow('Usage:')
    expect(() => parseEngineCommand('/engine claude opus extra')).toThrow('Usage:')
  })
  it('persists engine and model alongside existing settings', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'engine-settings-'))
    const cfg = loadConfig({ dataDir })
    apply(cfg, { engine: 'codex', engineModel: 'gpt-5', model: 'sonnet' })
    saveSettings(cfg)
    const restored = loadConfig({ dataDir })
    loadSettings(restored)
    expect(restored).toMatchObject({ engine: 'codex', engineModel: 'gpt-5', model: 'sonnet' })
    expect(check({ engine: 'invalid' as 'kimi' })).toHaveProperty('engine')
  })
  it('selects all engines and retains configured account fallbacks', () => {
    const chain = parseChain('claude:~/.second, codex, kimi')
    expect(selectedChain(chain, 'claude').map((p) => p.kind)).toEqual(['claude', 'claude', 'codex', 'kimi'])
    expect(selectedChain(chain, 'codex', 'gpt-5')[0]).toMatchObject({ kind: 'codex', model: 'gpt-5', id: 'codex:gpt-5' })
    expect(selectedChain(chain, 'kimi')[0].kind).toBe('kimi')
  })
  it('intercepts commands and switches only after the active turn, rebuilding memory', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'engine-api-'))
    const cfg = loadConfig({ dataDir })
    const mem = new Memory(cfg.dbPath)
    mem.nowUpdate('The owner is building a spaceship.')
    const calls: { engine: string; req: TurnRequest }[] = []
    let finish: ((r: TurnResult) => void) | undefined
    const { app, close, captain } = createApp({ mem, cfg, persistSettings: true, runnerFor: (p) => ({ run: async (req) => {
      calls.push({ engine: p.kind, req })
      if (calls.length === 1) return new Promise<TurnResult>((r) => { finish = r })
      return result
    } }) })
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
      await post('/api/messages', { text: '/engine' })
      expect(calls).toHaveLength(0)
      await post('/api/messages', { text: 'first' })
      await until(() => !!finish)
      await post('/api/messages', { text: '/engine codex' })
      expect(calls).toHaveLength(1)
      await post('/api/messages', { text: 'second' })
      finish!(result)
      await until(() => calls.length === 2 && !captain.busy)
      expect(calls[1].engine).toBe('codex')
      expect(calls[1].req.resume).toBe(false)
      expect(calls[1].req.sessionId).not.toBe(calls[0].req.sessionId)
      expect(calls[1].req.message).toContain('spaceship')
      expect((await post('/api/captain/engine', { engine: 'kimi' })).status).toBe(200)
      await post('/api/messages', { text: 'third' })
      await until(() => calls.length === 3 && !captain.busy)
      expect(calls[2]).toMatchObject({ engine: 'kimi', req: { resume: false } })
      expect((await post('/api/captain/engine', { engine: 'invalid' })).status).toBe(400)
    } finally { close(); mem.close() }
  })
})
