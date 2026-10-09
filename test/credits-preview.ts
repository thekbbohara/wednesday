// Read-only browser preview: built UI + new collector, existing GET APIs proxied
// from Wednesday. No Memory instance, database writes, agents, or inference.
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { resolve } from 'node:path'
import { isUsageCommand, validUsageCommand, usageReport } from '../src/credits-command.ts'
import { Credits } from '../src/credits.ts'
import { readSystem } from '../src/system.ts'
import { loadConfig } from '../src/config.ts'
import { loadSettings } from '../src/settings.ts'
const cfg = loadConfig()
loadSettings(cfg)
const credits = new Credits()
const app = new Hono()
app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
app.get('/api/credits', async c => { c.header('Cache-Control', 'no-store'); return c.json(await credits.read(cfg)) })
app.get('/api/system', async c => c.json(await readSystem()))
app.get('/api/*', async c => fetch(`http://127.0.0.1:4788${c.req.path}${new URL(c.req.url).search}`))
let previewId = 900_000_000
app.post('/api/messages', async c => {
  const body = await c.req.json().catch(() => null) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!isUsageCommand(text)) return c.text('Read-only preview: only /usages and /usage are supported', 405)
  const ts = new Date().toISOString()
  const report = validUsageCommand(text) ? usageReport((await credits.read(cfg)).accounts) : 'Usage: /usages (alias /usage).'
  return c.json({ item: { id: ++previewId, ts, type: 'owner', text }, reply: { id: ++previewId, ts, type: 'captain', text: report } })
})
app.all('/api/*', c => c.text('Read-only preview', 405))
app.use('/*', serveStatic({ root: resolve(import.meta.dirname, '../dist') }))
app.get('*', serveStatic({ root: resolve(import.meta.dirname, '../dist'), path: 'index.html' }))
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT || 4798) }, () => console.log('Read-only credits preview on http://127.0.0.1:4798'))
