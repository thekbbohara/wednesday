import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AGY_CAPTAIN_MODEL, AGY_WORKER_COMMAND } from '../src/engines.ts'
import { AgyRunner, parseAgyResult } from '../src/captain/agy.ts'
import { buildRunner } from '../src/captain/chain.ts'
import { parseChain, selectedChain } from '../src/captain/provider.ts'
import { apply, check, parseEngineCommand } from '../src/settings.ts'
import { loadConfig } from '../src/config.ts'
import { createApp } from '../src/server.ts'
import { buildServer } from '../src/mcp/server.ts'
import { loadRuntimes } from '../src/agents/runtimes.ts'
import type { LedgerEntry, Memory, Session } from '../src/memory/store.ts'
import type { TurnRequest, TurnResult } from '../src/captain/runner.ts'

const success: TurnResult = { text: 'hello', isError: false, contextTokens: 0, contextWindow: null, costUsd: 0 }
// Plain objects only: no SQLite connection, fixture schema or tmux.
function memory() {
  const rows: LedgerEntry[] = [], meta = new Map<string, string>()
  let current: Session | null = null
  return {
    rows,
    mem: {
      path: '/unused/memory.db',
      append: (kind: LedgerEntry['kind'], text: string, opts: any = {}) => {
        const row = { id: rows.length + 1, kind, text, ts: '2026-10-07T19:00:00Z', session: opts.session ?? null, meta: opts.meta ?? null }
        rows.push(row); return row
      },
      lastLedgerId: () => rows.at(-1)?.id ?? 0,
      ledgerSince: (id: number, kinds?: string[]) => rows.filter(r => r.id > id && (!kinds || kinds.includes(r.kind))),
      ledgerTail: (limit: number, kinds?: string[]) => rows.filter(r => !kinds || kinds.includes(r.kind)).slice(-limit).reverse(),
      metaGet: (key: string) => meta.get(key) ?? null,
      metaSet: (key: string, value: string) => meta.set(key, value),
      nowGet: () => ({ text: 'The owner is building a spaceship.', version: 1, updated_at: '' }),
      taskList: () => [], expBySkill: () => new Map(), searchFacts: () => [], searchLedger: () => [],
      sessionCurrent: () => current,
      sessionStart: (id: string) => current = { id, turns: 0, peak_tokens: 0, context_window: null, started_at: '', ended_at: null, end_reason: null },
      sessionTurn: () => { if (current) current.turns++ },
      sessionEnd: () => { current = null },
    } as unknown as Memory,
  }
}

describe('agy captain selection', () => {
  it('requires explicit captain models, Gemini for workers, and preserves explicit overrides', () => {
    expect(parseEngineCommand('/engine agy')).toEqual({ engine: 'agy', engineModel: '' })
    expect(parseEngineCommand('/engine agy gemini-3.1-pro-high')?.engineModel).toBe('gemini-3.1-pro-high')
    const cfg = loadConfig({ engine: 'codex', engineModel: 'gpt-5' })
    apply(cfg, { engine: 'agy' })
    expect(cfg.engineModel).toBe('')
    expect(check({ engine: ['agy'] as any })).toHaveProperty('engine')
    expect(check({ engine: 'agy', engineModel: 7 as any })).toHaveProperty('engineModel')
    expect(selectedChain(parseChain('agy,codex'), 'agy')[0]).toMatchObject({ kind: 'agy', id: 'agy' })
    expect(buildRunner(selectedChain(parseChain(''), 'agy')[0], cfg)).toBeInstanceOf(AgyRunner)
    expect(loadRuntimes('/nonexistent').find(r => r.id === 'agy')?.command).toBe(AGY_WORKER_COMMAND)
    const dataDir = mkdtempSync(join(tmpdir(), 'agy-override-'))
    try {
      writeFileSync(join(dataDir, 'runtimes.json'), JSON.stringify([{ id: 'agy', command: 'agy --model claude-sonnet-4-6' }]))
      expect(loadRuntimes(dataDir).find(r => r.id === 'agy')?.command).toBe('agy --model claude-sonnet-4-6')
    } finally { rmSync(dataDir, { recursive: true, force: true }) }
  })

  it('accepts real API/chat routes without inference and defers switching until the current turn ends', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agy-engine-'))
    const { mem } = memory()
    const cfg = loadConfig({ dataDir, engine: 'codex' })
    const calls: { kind: string; req: TurnRequest }[] = []
    let finish: ((r: TurnResult) => void) | undefined
    const { app, captain, close } = createApp({ mem, cfg, persistSettings: true, runnerFor: p => ({ run: async req => {
      calls.push({ kind: p.kind, req })
      if (calls.length === 1) return new Promise<TurnResult>(resolve => { finish = resolve })
      return success
    } }) })
    const post = (path: string, body: unknown, method = 'POST') => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const until = async (fn: () => boolean) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise(r => setTimeout(r, 5)); expect(fn()).toBe(true) }
    try {
      expect((await post('/api/captain/engine', { engine: { value: 'agy' } })).status).toBe(400)
      expect((await post('/api/settings', { engine: 'agy', engineModel: false }, 'PUT')).status).toBe(400)
      await post('/api/messages', { text: 'first turn' })
      await until(() => !!finish)
      await post('/api/messages', { text: '/engine agy' })
      expect(calls).toHaveLength(1)
      expect(cfg.engineModel).toBe('')
      await post('/api/messages', { text: 'second turn' })
      finish!(success)
      await until(() => calls.length === 2 && !captain.busy)
      expect(calls[0].kind).toBe('codex')
      expect(calls[1]).toMatchObject({ kind: 'agy', req: { resume: false } })
      expect(calls[1].req.sessionId).not.toBe(calls[0].req.sessionId)
      expect(calls[1].req.message).toContain('spaceship')
      expect((await post('/api/captain/engine', { engine: 'agy', model: 'claude-sonnet-4-6' })).status).toBe(200)
      expect(cfg.engineModel).toBe('claude-sonnet-4-6')
      expect((await post('/api/settings', { engineModel: '' }, 'PUT')).status).toBe(200)
      expect(cfg.engineModel).toBe('')
      expect(calls).toHaveLength(2)
    } finally { close(); rmSync(dataDir, { recursive: true, force: true }) }
  })

  it('starts isolated HTTP and routes MCP tools, cookies and captain prompts without SQLite or inference', async () => {
    const { mem } = memory()
    const dataDir = mkdtempSync(join(tmpdir(), 'wednesday-http-'))
    const cfg = loadConfig({ dataDir, engine: 'codex' })
    const calls: TurnRequest[] = []
    const { app, captain, close } = createApp({ mem, cfg, token: 'isolated-token', webRoot: resolve('dist'), runnerFor: () => ({ run: async req => { calls.push(req); return success } }) })
    const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    await new Promise<void>(r => { if (http.listening) r(); else http.once('listening', r) })
    const address = http.address() as { port: number }
    const url = `http://127.0.0.1:${address.port}`
    const mcp = buildServer(mem, null, { url, token: 'isolated-token' })
    const client = new Client({ name: 'wednesday-smoke', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    try {
      expect((await fetch(url + '/api/healthz')).status).toBe(401)
      const page = await fetch(url + '/?token=isolated-token')
      expect(page.headers.get('set-cookie')).toContain('wednesday_token=')
      expect(await page.text()).toContain('<title>Wednesday</title>')
      for (const cookie of ['wednesday_token', 'majordomo_token']) {
        const res = await fetch(url + '/api/healthz', { headers: { cookie: `${cookie}=isolated-token` } })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true })
        expect(cfg.name).toBe('Wednesday')
      }
      await mcp.connect(a); await client.connect(b)
      expect((await client.callTool({ name: 'captain_engine_set', arguments: { engine: 'codex' } })).isError).not.toBe(true)
      expect(cfg.engine).toBe('codex')
      await fetch(url + '/api/messages', { method: 'POST', headers: { authorization: 'Bearer isolated-token', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'runtime smoke' }) })
      for (let i = 0; i < 200 && (!calls.length || captain.busy); i++) await new Promise(r => setTimeout(r, 5))
      expect(calls).toHaveLength(1)
      expect(calls[0].systemPrompt).toContain('Wednesday')
      expect(calls[0].mcpServers.majordomo.env).toMatchObject({ WEDNESDAY_DB: cfg.dbPath, MAJORDOMO_DB: cfg.dbPath })
    } finally {
      await client.close(); await mcp.close(); close()
      await new Promise<void>((r, reject) => http.close(e => e ? reject(e) : r()))
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('exposes agy in the MCP schema and forwards the engine switch without a database', async () => {
    const { mem } = memory()
    const server = buildServer(mem, null, { url: 'http://engine.test' })
    const client = new Client({ name: 'test', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Engine selected' })))
    vi.stubGlobal('fetch', request)
    try {
      await server.connect(a); await client.connect(b)
      const tool = (await client.listTools()).tools.find(t => t.name === 'captain_engine_set')!
      expect((tool.inputSchema.properties?.engine as any).enum).toContain('agy')
      expect((await client.callTool({ name: 'captain_engine_set', arguments: { engine: 'agy' } })).isError).not.toBe(true)
      expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ engine: 'agy' })
    } finally { await client.close(); await server.close(); vi.unstubAllGlobals() }
  })
})

describe('agy headless captain runner', () => {
  it('isolates instructions/MCP, remembers conversations and resumes the exact id without credentials copying', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agy-runner-'))
    const fake = join(dataDir, 'fake-agy')
    writeFileSync(fake, `#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2),agent=args[args.indexOf('--agent')+1];
writeFileSync('launch.json',JSON.stringify({args,agent:readFileSync('.agents/agents/'+agent+'/agent.md','utf8')}));
console.log(JSON.stringify({status:'SUCCESS',conversation_id:'12345678-1234-1234-1234-123456789abc',response:'captain reply',num_turns:1,usage:{total_tokens:12000}}));
`, { mode: 0o700 })
    const req: TurnRequest = { sessionId: 'session-one', resume: false, message: 'owner message', systemPrompt: 'captain instructions', mcpServers: { majordomo: { command: 'node', args: ['mcp.ts'], env: { MAJORDOMO_DB: '/existing/db' } } } }
    try {
      const runner = new AgyRunner({ bin: fake, dataDir, timeoutSec: 5, model: AGY_CAPTAIN_MODEL })
      const first = await runner.run(req)
      expect(first).toMatchObject({ text: 'captain reply', isError: false, contextWindow: null, contextTokens: 0 })
      const cwd = join(dataDir, 'agy-captain', req.sessionId)
      let launch = JSON.parse(readFileSync(join(cwd, 'launch.json'), 'utf8'))
      expect(launch.args).toContain(AGY_CAPTAIN_MODEL)
      expect(launch.args).toContain('--print=owner message')
      expect(launch.args).not.toContain('--continue')
      const frontmatter = JSON.parse(launch.agent.split('\n')[1])
      expect(frontmatter).toMatchObject({ inheritCustomizations: false, inheritMcp: false, excludeDefaultComponents: true, tools: [], mcpServers: [{ serverName: 'majordomo', ...req.mcpServers.majordomo }] })
      expect(launch.agent).toContain('captain instructions')
      expect((await runner.run({ ...req, resume: true })).isError).toBe(false)
      launch = JSON.parse(readFileSync(join(cwd, 'launch.json'), 'utf8'))
      expect(launch.args.slice(-2)).toEqual(['--conversation', '12345678-1234-1234-1234-123456789abc'])
      expect((await runner.run({ ...req, sessionId: 'no-map', resume: true })).sessionMissing).toBe(true)
      const override = new AgyRunner({ bin: fake, dataDir, timeoutSec: 5, model: 'gemini-3.1-pro-high' })
      expect(override.prepare(req).args).toContain('gemini-3.1-pro-high')
      expect(() => override.prepare({ ...req, sessionId: '../escape' })).toThrow()
    } finally { rmSync(dataDir, { recursive: true, force: true }) }
  })

  it('does not launch an implicit unverified model', async () => {
    const runner = new AgyRunner({ bin: '/must-not-launch', dataDir: '/must-not-write', timeoutSec: 1 })
    const result = await runner.run({ sessionId: 'blocked', resume: false, message: 'hello', systemPrompt: '', mcpServers: {} })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('explicitly verified agy model')
  })

  it('sanitizes failures and keeps aggregate token use separate from context size', () => {
    expect(parseAgyResult('invalid')).toBeNull()
    expect(parseAgyResult(JSON.stringify({ status: 'ERROR', response: 'model unavailable secret-token' }))?.result.text).toContain('model is unavailable or inaccessible')
    expect(parseAgyResult(JSON.stringify({ status: 'SUCCESS', response: 'hello', conversation_id: 'id', usage: { total_tokens: 50000 } }))?.result).toMatchObject({ contextTokens: 0, contextWindow: null, text: 'hello' })
    expect(parseAgyResult(JSON.stringify({ status: 'ERROR', response: 'quota exceeded secret-token' }))?.result.text).toBe('Antigravity usage limit reached.')
    expect(parseAgyResult(JSON.stringify({ status: 'ERROR', response: 'secret-token' }))?.result.text).not.toContain('secret-token')
  })
})
