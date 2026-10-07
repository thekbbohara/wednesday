// Local review only: live GET payloads, ephemeral settings/ledger, real read-only
// quota collector. Never instantiates Memory/SQLite, supervisor or a model CLI.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadEnvFile } from 'node:process'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { loadConfig } from '../src/config.ts'
import { assistantEnv } from '../src/env.ts'
import { loadSettings, currentSettings } from '../src/settings.ts'
import { createApp } from '../src/server.ts'
import { isUsageCommand } from '../src/credits-command.ts'
import { buildServer } from '../src/mcp/server.ts'
import { loadRuntimes } from '../src/agents/runtimes.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Memory, LedgerEntry, Session, Task, Now } from '../src/memory/store.ts'
import type { ChatItem } from '../src/web/chat.ts'
import type { Status } from '../src/server.ts'

loadEnvFile('/home/kb26/kb/jarvis/.env')
const cfg = loadConfig({ dataDir: '/home/kb26/.jarvis', name: 'Wednesday' })
loadSettings(cfg)
const ownerToken = assistantEnv('TOKEN')
async function liveGet(path: string) {
  const res = await fetch('http://127.0.0.1:4788' + path, { headers: ownerToken ? { authorization: `Bearer ${ownerToken}` } : {} })
  if (!res.ok) throw new Error(`Read-only live GET ${path}: HTTP ${res.status}`)
  return res.json()
}
const seed = await liveGet('/api/chat?limit=20') as { items: ChatItem[]; status: Status; hasMore: boolean }
const tasks = await liveGet('/api/tasks') as { tasks: Task[] }
const memory = await liveGet('/api/memory') as { now: Now }
const rows: LedgerEntry[] = []
let session: Session | null = null
const meta = new Map<string, string>()
let runnerCalls = 0
const mem = {
  path: cfg.dbPath,
  append: (kind: LedgerEntry['kind'], text: string, opts: Partial<LedgerEntry> = {}) => {
    const row = { id: 900000000 + rows.length, kind, text, ts: new Date().toISOString(), session: opts.session ?? null, meta: opts.meta ?? null }
    rows.push(row); return row
  },
  lastLedgerId: () => rows.at(-1)?.id ?? 0,
  ledgerSince: (id: number) => rows.filter(r => r.id > id),
  ledgerTail: (limit: number, kinds?: string[]) => rows.filter(r => !kinds || kinds.includes(r.kind)).slice(-limit).reverse(),
  expBySkill: () => new Map(seed.status.skills.map(s => [s.id, s.exp])),
  taskList: (opts: { status?: string; limit?: number } = {}) => tasks.tasks.filter(t => !opts.status || t.status === opts.status).slice(0, opts.limit ?? 500),
  nowGet: () => memory.now,
  metaGet: (key: string) => meta.get(key) ?? null,
  metaSet: (key: string, value: string) => meta.set(key, value),
  sessionCurrent: () => session,
  sessionStart: (id: string) => session = { id, turns: 0, peak_tokens: 0, context_window: null, started_at: '', ended_at: null, end_reason: null },
  sessionTurn: () => { if (session) session.turns++ },
  sessionEnd: () => { session = null },
} as unknown as Memory
const previewToken = 'T50-local-review'
const production = createApp({ mem, cfg, token: previewToken, persistSettings: false,
  webRoot: resolve('dist'), agents: () => seed.status.agents,
  runnerFor: () => ({ run: async () => { runnerCalls++; throw new Error('Inference is disabled in T50 review') } }),
})
const app = new Hono()
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' && c.req.path === '/api/messages') {
    const body = await c.req.raw.clone().json().catch(() => null) as { text?: unknown } | null
    if (typeof body?.text !== 'string' || !isUsageCommand(body.text.trim())) return c.text('Review allows only /usage and /usages; no inference.', 405)
  } else if (!['GET', 'HEAD'].includes(c.req.method) && !['/api/settings', '/api/captain/engine'].includes(c.req.path)) {
    return c.text('Review mutation is disabled.', 405)
  }
  await next()
})
app.get('/api/chat', async c => {
  if (c.req.header('cookie')?.includes('wednesday_token=' + previewToken) || c.req.header('authorization') === 'Bearer ' + previewToken) {
    return c.json({ ...seed, items: [...seed.items, ...rows.filter(r => r.kind === 'owner' || r.kind === 'captain').map(r => ({ id: r.id, ts: r.ts, text: r.text, type: r.kind }))], status: { ...seed.status, name: cfg.name, engine: cfg.engine, model: cfg.engineModel || 'default' } })
  }
  return production.app.fetch(c.req.raw)
})
app.get('/api/settings', async c => {
  if (c.req.header('cookie')?.includes('wednesday_token=' + previewToken) || c.req.header('authorization') === 'Bearer ' + previewToken) {
    const res = await production.app.fetch(c.req.raw)
      const body = await res.json() as { about: { runtimes: { id: string; command: string }[] } }
      body.about.runtimes = loadRuntimes(cfg.dataDir).map(r => ({ id: r.id, command: r.command }))
      return c.json(body)
  }
  return production.app.fetch(c.req.raw)
})
app.route('/', production.app)
const port = Number(process.env.T50_REVIEW_PORT || 4808)
const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })
await new Promise<void>(r => { if (http.listening) r(); else http.once('listening', r) })
const url = `http://127.0.0.1:${port}`
const mcp = buildServer(mem, null, { url, token: previewToken })
const client = new Client({ name: 'T50-reviewed-smoke', version: '1' })
const [a, b] = InMemoryTransport.createLinkedPair()
const smoke: Record<string, unknown> = { url, originalEngine: cfg.engine, sqliteOpened: false, persistence: false, liveSources: 'GET /api/chat, /api/tasks, /api/memory only' }
await mcp.connect(a); await client.connect(b)
smoke.toolCount = (await client.listTools()).tools.length
smoke.nowGet = !(await client.callTool({ name: 'now_get', arguments: {} })).isError
smoke.engineTool = !(await client.callTool({ name: 'captain_engine_set', arguments: { engine: 'codex' } })).isError
const headers = { authorization: 'Bearer ' + previewToken, 'content-type': 'application/json' }
const blocked = await fetch(url + '/api/messages', { method: 'POST', headers, body: JSON.stringify({ text: 'must never infer' }) })
smoke.nonUsageBlocked = blocked.status === 405
const usage = await fetch(url + '/api/messages', { method: 'POST', headers, body: JSON.stringify({ text: '/usages' }) })
const usageBody = await usage.json() as { reply?: { text: string } }
smoke.usageRoute = usage.ok && !!usageBody.reply?.text.startsWith('Runtime usage (provider-reported')
smoke.usageReplyCharacters = usageBody.reply?.text.length
smoke.runnerCalls = runnerCalls
smoke.settings = currentSettings(cfg)
if (!smoke.nowGet || !smoke.engineTool || !smoke.nonUsageBlocked || !smoke.usageRoute || runnerCalls) throw new Error('T50 smoke failed: ' + JSON.stringify(smoke))
writeFileSync('reports/T50-integration/http-mcp-smoke.json', JSON.stringify(smoke, null, 2) + '\n')
await client.close(); await mcp.close()
console.log(JSON.stringify({ preview: url + '/?token=' + previewToken, smoke: 'passed', runnerCalls }))
const shutdown = () => { production.close(); http.close(() => process.exit(0)) }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
