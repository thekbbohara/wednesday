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
import { Supervisor, SupervisorError, type AgentView } from './agents/supervisor.ts'
import type { LedgerEntry } from './memory/store.ts'
import { ClaudeSleepModel } from './sleep/sleep.ts'
import { loadSkills, type Skill } from './skills/skills.ts'
import { apply, check, currentSettings, loadSettings, MODELS, saveSettings, type Settings } from './settings.ts'
import { EXP_RULES, OVERALL_SCALE, progress, type Progress } from './skills/levels.ts'
import { startSleepSchedule } from './sleep/schedule.ts'

export interface Agent {
  id: string
  name: string
  runtime: string
  state: 'idle' | 'working' | 'needs' | 'error' | 'offline'
  reason: string | null
  task: number | null
}

export interface SkillView extends Skill, Progress {}

export interface Status {
  thinking: boolean
  agents: Agent[]
  model: string
  /** When Jarvis last replied, for "Active 2m ago". */
  lastReplyAt: string | null
  /** Jarvis overall, from all EXP. */
  jarvis: Progress
  skills: SkillView[]
  /** Tasks waiting on the owner, for the nav badge. */
  waiting: number
}

const MAX_MESSAGE_CHARS = 20_000

export function createApp(opts: {
  mem: Memory
  cfg: Config
  runner: Runner
  token?: string
  pollMs?: number
  webRoot?: string
  /** Runs the worker agents; without one, agent endpoints answer 503. */
  supervisor?: Supervisor
  /** Where this server is reachable for agent hooks and the captain's agent tools. */
  selfUrl?: string
  /** Agents for the header, when there is no supervisor (demo). */
  agents?: () => Agent[]
  /** Write settings changes to <data>/settings.json (off in tests). */
  persistSettings?: boolean
}) {
  const { mem, cfg, token, supervisor: sup } = opts
  const captain = new Captain(mem, cfg, opts.runner)
  if (sup && opts.selfUrl) {
    captain.agents = { summary: () => sup.summary(), url: opts.selfUrl, token }
    // Zero-token supervision: the captain only runs when an agent needs it.
    sup.on('event', (entry: LedgerEntry, wake: boolean) => {
      if (wake) captain.enqueue(entry)
      tick()
    })
  }
  const lockPath = join(cfg.dataDir, 'captain.lock')

  // Live events: one poller over the ledger (it also sees what the terminal and
  // the MCP server write), fanned out to every open chat.
  type Listener = (event: 'items' | 'status', data: unknown) => void
  const listeners = new Set<Listener>()
  let cursor = mem.lastLedgerId()
  let lastStatus = ''
  const toAgent = (a: AgentView): Agent => ({ id: a.id, name: a.id, runtime: a.runtime, state: a.mood, reason: a.reason, task: a.task_id })
  const lastReply = () => {
    const [last] = mem.ledgerTail(1, ['captain'])
    return last?.ts ?? null
  }
  const skills = loadSkills(cfg.dataDir)
  const status = (): Status => {
    const exp = mem.expBySkill()
    const total = [...exp.values()].reduce((a, b) => a + b, 0)
    return {
      thinking: captain.busy || existsSync(lockPath),
      agents: sup ? sup.list().map(toAgent) : (opts.agents?.() ?? []),
      model: cfg.model,
      lastReplyAt: lastReply(),
      jarvis: progress(total, OVERALL_SCALE),
      skills: skills.map((sk) => ({ ...sk, ...progress(exp.get(sk.id) ?? 0) })),
      waiting: mem.taskList({ status: 'waiting_owner', limit: 500 }).length,
    }
  }
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

  // ---- pages: skills, tasks, memory, settings ------------------------------

  app.get('/api/skills', (c) => {
    const exp = mem.expBySkill()
    return c.json({ skills: skills.map((sk) => ({ ...sk, ...progress(exp.get(sk.id) ?? 0), recent: mem.expEvents(sk.id, 3) })), rules: EXP_RULES })
  })

  app.get('/api/tasks', (c) => {
    const agentsByTask = new Map<number, Agent>()
    if (sup) for (const a of sup.list()) if (a.task_id) agentsByTask.set(a.task_id, toAgent(a))
    const tasks = mem.taskList({ limit: 500 }).map((t) => ({ ...t, agent: agentsByTask.get(t.id) ?? null }))
    return c.json({ tasks })
  })

  app.get('/api/memory', (c) => {
    const q = c.req.query('q')?.trim()
    if (q) return c.json({ query: q, hits: mem.search(q, { limit: 20, includeStale: true }) })
    const digests = mem.ledgerTail(60, ['digest']).reverse().map((d) => ({ id: d.id, ts: d.ts, date: String(d.meta?.date ?? d.ts.slice(0, 10)), text: d.text }))
    return c.json({ now: mem.nowGet(), facts: mem.factsAll(true).reverse(), digests })
  })

  app.get('/api/settings', (c) =>
    c.json({
      settings: currentSettings(cfg),
      models: MODELS,
      about: {
        dataDir: cfg.dataDir,
        token: !!token,
        runtimes: sup ? sup.runtimes.map((r) => ({ id: r.id, command: r.command })) : [],
        skillsFile: join(cfg.dataDir, 'skills.json'),
        settingsFile: join(cfg.dataDir, 'settings.json'),
      },
    }),
  )

  app.put('/api/settings', async (c) => {
    const patch = ((await c.req.json().catch(() => null)) ?? {}) as Partial<Settings>
    const known = Object.fromEntries(Object.entries(patch).filter(([k]) => k in currentSettings(cfg))) as Partial<Settings>
    const errors = check(known)
    if (Object.keys(errors).length) return c.json({ errors }, 400)
    apply(cfg, known)
    if (opts.persistSettings) saveSettings(cfg)
    tick()
    return c.json({ settings: currentSettings(cfg) })
  })

  app.get('/api/skills/:id', (c) => {
    const sk = skills.find((x) => x.id === c.req.param('id'))
    if (!sk) return c.json({ error: 'not found' }, 404)
    return c.json({ skill: { ...sk, ...progress(mem.expBySkill().get(sk.id) ?? 0) }, rules: EXP_RULES, events: mem.expEvents(sk.id, 8) })
  })

  app.get('/api/ref/:ref', (c) => {
    const r = describeRef(mem, c.req.param('ref'))
    return r ? c.json(r) : c.json({ error: 'not found' }, 404)
  })

  // ---- agents: the captain's tools and the header popover --------------------

  const needSup = () => {
    if (!sup) throw new SupervisorError('Agents are not available in this server', 503)
    return sup
  }
  const agentRoute =
    <T,>(fn: (c: import('hono').Context) => Promise<T> | T) =>
    async (c: import('hono').Context) => {
      try {
        const out = await fn(c)
        tick()
        return c.json(out as object)
      } catch (e) {
        const status = e instanceof SupervisorError ? e.status : 500
        return c.json({ error: (e as Error).message }, status as 400)
      }
    }
  const param = (c: import('hono').Context) => c.req.param('id') ?? ''
  const body = async (c: import('hono').Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

  app.get(
    '/api/agents',
    agentRoute((c) => {
      const s = needSup()
      return c.req.query('format') === 'text' ? { text: s.summary() || 'No agents.' } : { agents: s.list() }
    }),
  )

  app.get(
    '/api/agents/:id',
    agentRoute((c) => {
      const a = needSup().get(param(c))
      const report = mem.agentLastEvent(a.id, 'report')
      const task = a.task_id ? mem.taskGet(a.task_id) : null
      return { agent: a, task: task ? { id: task.id, title: task.title, status: task.status } : null, lastReport: report ? { id: report.id, ts: report.ts, text: report.text.replace(/^\S+ reported:\n/, '') } : null }
    }),
  )

  app.get(
    '/api/agents/:id/screen',
    agentRoute(async (c) => {
      const s = needSup()
      const a = s.get(param(c))
      const lines = Math.min(Math.max(Number(c.req.query('lines') ?? 60) || 60, 10), 400)
      const screen = (await s.screen(a.id, lines)).replace(/\s+$/, '')
      const head = `${a.id} is ${a.mood}${a.reason ? ` (${a.reason})` : ''}${a.choices ? `; options: ${a.choices.map((x) => x.label).join(' | ')}` : ''}`
      return { text: `${head}\n\n${screen || '(no screen: not running)'}` }
    }),
  )

  app.post(
    '/api/agents',
    agentRoute(async (c) => {
      const b = await body(c)
      const a = await needSup().spawn({
        id: String(b.id ?? ''),
        runtime: String(b.runtime ?? 'claude-code'),
        brief: String(b.brief ?? ''),
        task_id: typeof b.task_id === 'number' ? b.task_id : null,
        repo: typeof b.repo === 'string' && b.repo ? b.repo : undefined,
        cwd: typeof b.cwd === 'string' && b.cwd ? b.cwd : undefined,
        branch: typeof b.branch === 'string' && b.branch ? b.branch : undefined,
        base: typeof b.base === 'string' && b.base ? b.base : undefined,
      })
      return { text: `Started ${a.id} on ${a.runtime}${a.branch ? `, worktree ${a.cwd} on branch ${a.branch}` : ` in ${a.cwd}`}. Its brief goes in once it is ready; you will be woken when it reports.` }
    }),
  )

  app.post(
    '/api/agents/:id/send',
    agentRoute(async (c) => {
      await needSup().send(param(c), String((await body(c)).text ?? ''))
      return { text: 'Sent.' }
    }),
  )

  app.post(
    '/api/agents/:id/answer',
    agentRoute(async (c) => {
      const label = String((await body(c)).label ?? '')
      await needSup().answer(param(c), label)
      return { text: `Answered: ${label}` }
    }),
  )

  app.post(
    '/api/agents/:id/stop',
    agentRoute(async (c) => {
      const a = await needSup().stopAgent(param(c), (await body(c)).remove === true)
      return { text: a.status === 'removed' ? `${a.id} removed${a.branch ? `; branch ${a.branch} kept in ${a.repo}` : ''}.` : `${a.id} stopped.` }
    }),
  )

  // Agents' turn hooks report here (see src/agents/hooks.ts).
  app.post(
    '/api/hooks/turn',
    agentRoute(async (c) => {
      const b = await body(c)
      const entry = needSup().report(String(b.agent ?? ''), String(b.message ?? ''))
      return { ok: true, id: entry?.id ?? null }
    }),
  )

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
    // Hashed bundles never change; the page that names them must always be fresh, or a rebuild goes unseen.
    // (serveStatic's onFound runs after the response is built, so headers go on here.)
    app.use('/*', async (c, next) => {
      await next()
      if (c.req.path.startsWith('/api/') || !c.res.ok) return
      c.res.headers.set('cache-control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    })
    app.use('/*', serveStatic({ root }))
    app.get('*', serveStatic({ root, path: 'index.html' }))
  }

  return {
    app,
    captain,
    close: () => {
      clearInterval(timer)
      sup?.stop()
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig()
  loadSettings(cfg)
  const mem = new Memory(cfg.dbPath, { nowBudgetChars: cfg.nowBudgetChars })
  // Getters, so changes made in Settings apply to the next turn.
  const runner = new ClaudeRunner({ bin: cfg.claudeBin, model: () => cfg.model, cwd: cfg.dataDir, allowedTools: () => cfg.allowedTools, timeoutSec: cfg.turnTimeout })
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 4788)
  const token = process.env.JARVIS_TOKEN || undefined
  if (!token && host !== '127.0.0.1' && host !== 'localhost') console.warn(`warning: listening on ${host} without JARVIS_TOKEN`)
  // Where agents' hooks and the captain's tools reach this server (loopback when listening on all addresses).
  const selfUrl = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}`
  const supervisor = new Supervisor({ mem, dataDir: cfg.dataDir, socket: process.env.JARVIS_TMUX_SOCKET || 'jarvis', hook: { url: selfUrl, token } })
  supervisor.start()
  const { app } = createApp({ mem, cfg, runner, token, supervisor, selfUrl, persistSettings: true, webRoot: resolve(import.meta.dirname, '../dist') })
  startSleepSchedule(mem, cfg, new ClaudeSleepModel({ bin: cfg.claudeBin, model: () => cfg.sleepModel, promptFile: cfg.sleepPromptFile, timeoutSec: cfg.turnTimeout, cwd: cfg.dataDir }))
  serve({ fetch: app.fetch, hostname: host, port }, () => console.log(`jarvis on http://${host}:${port} - memory ${cfg.dbPath} - model ${cfg.model} - sleep ${cfg.sleepAt || 'off'}`))
}
