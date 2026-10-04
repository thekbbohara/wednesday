// Jarvis web server: the chat API, live events, and the built UI.
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, type Config } from './config.ts'
import { Memory } from './memory/store.ts'
import { Captain } from './captain/captain.ts'
import { ClaudeRunner, type Runner } from './captain/runner.ts'
import { chatPage, describeRef, toChatItem, type ChatItem } from './web/chat.ts'

export interface Agent {
  id: string
  name: string
  runtime: string
  state: 'idle' | 'working' | 'needs' | 'error' | 'offline'
}

export interface Status {
  thinking: boolean
  agents: Agent[]
}

const MAX_MESSAGE_CHARS = 20_000

export function createApp(opts: {
  mem: Memory
  cfg: Config
  runner: Runner
  token?: string
  pollMs?: number
  webRoot?: string
  /** Agents for the strip; step 3 plugs the agent-hq engine in here. */
  agents?: () => Agent[]
}) {
  const { mem, cfg, token } = opts
  const captain = new Captain(mem, cfg, opts.runner)
  const lockPath = join(cfg.dataDir, 'captain.lock')

  // Live events: one poller over the ledger (it also sees what the terminal and
  // the MCP server write), fanned out to every open chat.
  type Listener = (event: 'items' | 'status', data: unknown) => void
  const listeners = new Set<Listener>()
  let cursor = mem.lastLedgerId()
  let lastStatus = ''
  const status = (): Status => ({ thinking: captain.busy || existsSync(lockPath), agents: opts.agents?.() ?? [] })
  const tick = () => {
    const fresh = mem.ledgerSince(cursor)
    if (fresh.length) {
      cursor = fresh[fresh.length - 1].id
      const items = fresh.map(toChatItem).filter((i): i is ChatItem => i !== null)
      if (items.length) for (const l of listeners) l('items', items)
    }
    const s = status()
    const key = JSON.stringify(s)
    if (key !== lastStatus) {
      lastStatus = key
      for (const l of listeners) l('status', s)
    }
  }
  captain.onStatus = () => tick()
  const timer = setInterval(tick, opts.pollMs ?? 400)

  const app = new Hono()

  if (token) {
    // Open /?token=... once; the cookie keeps you signed in. Tools send a bearer header.
    app.use('*', async (c, next) => {
      const url = new URL(c.req.url)
      if (url.searchParams.get('token') === token) {
        c.header('set-cookie', `jarvis_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`)
        return next()
      }
      const cookie = c.req.header('cookie')?.match(/(?:^|;\s*)jarvis_token=([^;]+)/)?.[1]
      const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
      if (cookie === token || bearer === token) return next()
      return c.text('jarvis: open /?token=<JARVIS_TOKEN> once to sign in', 401)
    })
  }

  app.get('/api/healthz', (c) => c.json({ ok: true }))

  app.get('/api/chat', (c) => {
    const before = c.req.query('before')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 40) || 40, 1), 200)
    return c.json({ ...chatPage(mem, before ? Number(before) : null, limit), status: status() })
  })

  app.post('/api/messages', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return c.json({ error: 'empty message' }, 400)
    if (text.length > MAX_MESSAGE_CHARS) return c.json({ error: `message is over ${MAX_MESSAGE_CHARS} characters` }, 413)
    const owner = captain.receive(text)
    captain.enqueue(owner)
    tick()
    return c.json({ item: toChatItem(owner) })
  })

  app.post('/api/retry', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null
    try {
      captain.retry(Number(body?.id))
      tick()
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  app.get('/api/ref/:ref', (c) => {
    const r = describeRef(mem, c.req.param('ref'))
    return r ? c.json(r) : c.json({ error: 'not found' }, 404)
  })

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const send: Listener = (event, data) => void stream.writeSSE({ event, data: JSON.stringify(data) })
      listeners.add(send)
      send('status', status())
      const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 25_000)
      await new Promise<void>((done) => stream.onAbort(done))
      clearInterval(ping)
      listeners.delete(send)
    }),
  )

  if (opts.webRoot && existsSync(opts.webRoot)) {
    const root = relative(process.cwd(), opts.webRoot) || '.'
    app.use('/*', serveStatic({ root }))
    app.get('*', serveStatic({ root, path: 'index.html' }))
  }

  return { app, captain, close: () => clearInterval(timer) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig()
  const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })
  const runner = new ClaudeRunner({ bin: cfg.claudeBin, model: cfg.model, cwd: cfg.dataDir, allowedTools: cfg.allowedTools, timeoutSec: cfg.turnTimeout })
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 4788)
  const token = process.env.JARVIS_TOKEN || undefined
  if (!token && host !== '127.0.0.1' && host !== 'localhost') console.warn(`warning: listening on ${host} without JARVIS_TOKEN`)
  const { app } = createApp({ mem, cfg, runner, token, webRoot: resolve(import.meta.dirname, '../dist') })
  serve({ fetch: app.fetch, hostname: host, port }, () => console.log(`jarvis on http://${host}:${port} - memory ${cfg.dbPath} - model ${cfg.model}`))
}
