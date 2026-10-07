import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { createApp } from '../src/server.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

/** A runner whose turns finish only when the test says so. */
class GatedRunner implements Runner {
  calls: TurnRequest[] = []
  results: ((r: Partial<TurnResult>) => void)[] = []
  async run(req: TurnRequest): Promise<TurnResult> {
    this.calls.push(req)
    const r = await new Promise<Partial<TurnResult>>((res) => this.results.push(res))
    return { text: 'ok', contextTokens: 1000, contextWindow: 200000, costUsd: 0, isError: false, ...r }
  }
  async finish(r: Partial<TurnResult> = {}) {
    await until(() => this.results.length > 0)
    this.results.shift()!(r)
  }
}

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function setup(token?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-srv-'))
  const cfg = loadConfig({ dataDir })
  const mem = new Memory(cfg.dbPath)
  const runner = new GatedRunner()
  const { app, captain, close } = createApp({ mem, cfg, runner, token, pollMs: 50 })
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { mem, runner, app, captain, close, post }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json()

const owners = (msg: string) => [...msg.matchAll(/<owner_message[^>]*>\n([\s\S]*?)\n<\/owner_message>/g)].map((m) => m[1])

describe('web server', () => {
  it('answers messages sent while thinking together, in one turn', async () => {
    const { runner, captain, post, app, close } = setup()
    expect((await json(post('/api/messages', { text: 'first' }))).item).toMatchObject({ type: 'owner', text: 'first' })
    await until(() => runner.calls.length === 1)
    await post('/api/messages', { text: 'second' })
    await post('/api/messages', { text: 'third' })
    expect(captain.busy).toBe(true)
    await runner.finish({ text: 'reply one' })
    await until(() => runner.calls.length === 2)
    expect(owners(runner.calls[1].message)).toEqual(['second', 'third'])
    await runner.finish({ text: 'reply two' })
    await until(() => !captain.busy)
    const page = await json(app.request('/api/chat'))
    expect(page.items.map((i: { type: string; text?: string }) => `${i.type}:${i.text ?? ''}`)).toEqual([
      // Chronological, like any messenger: reply one landed after second and third were sent.
      'owner:first',
      'owner:second',
      'owner:third',
      'captain:reply one',
      'captain:reply two',
    ])
    close()
  })

  it('shows failures and retries them', async () => {
    const { runner, captain, post, app, close } = setup()
    await post('/api/messages', { text: 'hi' })
    await runner.finish({ isError: true, text: 'overloaded' })
    await until(() => !captain.busy)
    const err = (await json(app.request('/api/chat'))).items.at(-1)
    expect(err).toMatchObject({ type: 'error', text: 'overloaded' })
    expect((await post('/api/retry', { id: err.id })).status).toBe(200)
    await runner.finish({ text: 'better now' })
    await until(() => !captain.busy)
    expect(owners(runner.calls[1].message)).toEqual(['hi'])
    expect((await json(app.request('/api/chat'))).items.at(-1)).toMatchObject({ type: 'captain', text: 'better now' })
    expect((await post('/api/retry', { id: 1 })).status).toBe(400)
    close()
  })

  it('turns memory writes into receipts and resolves citations', async () => {
    const { mem, app, close } = setup()
    mem.append('owner', 'remember the tea')
    const f = mem.factWrite({ kind: 'preference', subject: 'tea', body: 'ilam green', source: 'L1' })
    const t = mem.taskCreate({ title: 'buy tea', goal: 'restock' })
    // A result that mentions "created" is still a finish, not a creation.
    mem.taskUpdate(t.id, { status: 'done', result: 'order created and paid' })
    mem.append('captain', `Saved [F${f.id}]`)
    const page = await json(app.request('/api/chat'))
    expect(page.items.filter((i: { type: string }) => i.type === 'receipt').map((i: { verb: string; ref: string }) => `${i.verb} ${i.ref}`)).toEqual([
      'saved F1',
      'created T1',
      'finished T1',
    ])
    expect(await json(app.request('/api/ref/F1'))).toMatchObject({ ref: 'F1', title: 'tea', body: 'ilam green', source: 'L1' })
    expect(await json(app.request('/api/ref/T1'))).toMatchObject({ title: 'buy tea (done)' })
    expect(await json(app.request('/api/ref/L1'))).toMatchObject({ title: 'You said', body: 'remember the tea' })
    expect((await app.request('/api/ref/F99')).status).toBe(404)
    const d = mem.append('decision', 'Decision: Use SQLite. Reason: one file')
    expect(await json(app.request(`/api/ref/L${d.id}`))).toMatchObject({ title: 'Decision', body: 'Use SQLite.\n\nWhy: one file' })
    close()
  })

  it('pages back through history by message count', async () => {
    const { mem, app, close } = setup()
    for (let i = 1; i <= 50; i++) mem.append(i % 2 ? 'owner' : 'captain', `m${i}`)
    const p1 = await json(app.request('/api/chat?limit=20'))
    expect(p1.items.map((i: { text: string }) => i.text)).toEqual(Array.from({ length: 20 }, (_, k) => `m${31 + k}`))
    expect(p1.hasMore).toBe(true)
    const p3 = await json(app.request(`/api/chat?limit=20&before=${p1.items[0].id - 20}`))
    expect(p3.items.map((i: { text: string }) => i.text)).toEqual(Array.from({ length: 10 }, (_, k) => `m${1 + k}`))
    expect(p3.hasMore).toBe(false)
    close()
  })

  it('hides session plumbing from the chat', async () => {
    const { mem, app, close } = setup()
    mem.append('system', 'Captain session x started')
    mem.append('rotation', 'Captain session x rotated: test')
    mem.append('owner', 'hi')
    expect((await json(app.request('/api/chat'))).items.map((i: { type: string }) => i.type)).toEqual(['owner'])
    close()
  })

  it('rejects empty and oversized messages', async () => {
    const { post, close } = setup()
    expect((await post('/api/messages', { text: '   ' })).status).toBe(400)
    expect((await post('/api/messages', { text: 'x'.repeat(20_001) })).status).toBe(413)
    close()
  })

  it('requires the token when one is set', async () => {
    const { app, close } = setup('s3cret')
    expect((await app.request('/api/chat')).status).toBe(401)
    expect((await app.request('/api/chat', { headers: { authorization: 'Bearer s3cret' } })).status).toBe(200)
    const signin = await app.request('/?token=s3cret')
    expect(signin.headers.get('set-cookie')).toMatch(/wednesday_token=s3cret; .*HttpOnly/)
    expect((await app.request('/api/chat', { headers: { cookie: 'majordomo_token=s3cret' } })).status).toBe(200)
    close()
  })
})

describe('web server with agents', () => {
  it('spawns through the API, wakes the captain on a report, and keeps silent replies out of the chat', { timeout: 30_000 }, async () => {
    const { Supervisor } = await import('../src/agents/supervisor.ts')
    const { writeFileSync } = await import('node:fs')
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-srv-agents-'))
    writeFileSync(join(dataDir, 'runtimes.json'), JSON.stringify([{ id: 'fake', command: `bash ${join(import.meta.dirname, '../src/agents/fixtures/fake-agent.sh')}` }]))
    const cfg = loadConfig({ dataDir })
    const mem = new Memory(cfg.dbPath)
    const socket = `majordomo-srv-${process.pid}`
    const sup = new Supervisor({ mem, dataDir, socket, hook: null, pollMs: 100, timings: { briefSettleMs: 300 } })
    const runner = new GatedRunner()
    const { app, captain, close } = createApp({ mem, cfg, runner, supervisor: sup, selfUrl: 'http://127.0.0.1:1', pollMs: 50 })
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
      const t = mem.taskCreate({ title: 'Count files', goal: 'g' })
      const spawned = await post('/api/agents', { id: 'counter', runtime: 'fake', cwd: dataDir, brief: 'count files', task_id: t.id })
      expect(spawned.status).toBe(200)
      expect((await json(spawned)).text).toMatch(/^Started counter on fake in /)
      expect((await post('/api/agents', { id: 'counter', runtime: 'fake', cwd: dataDir, brief: 'x' })).status).toBe(409)

      // The hook reports; the captain is woken with the event and the live agents block.
      expect((await post('/api/hooks/turn', { agent: 'counter', source: 'claude', message: 'There are 3 files.' })).status).toBe(200)
      await until(() => runner.calls.length === 1)
      const msg = runner.calls[0].message
      expect(msg).toMatch(/<agents note="live, from the supervisor">\ncounter \[\w+\] fake T1 - /)
      expect(msg).toMatch(/<agent_event id="L\d+" agent="counter" event="report"[^>]*>\ncounter reported:\nThere are 3 files\.\n<\/agent_event>/)
      expect(runner.calls[0].mcpServers.majordomo.env.MAJORDOMO_URL).toBe('http://127.0.0.1:1')
      await runner.finish({ text: 'NOTHING_TO_REPORT' })
      await until(() => !captain.busy)

      const items = (await json(app.request('/api/chat'))).items as { type: string; event?: string; text?: string }[]
      expect(items.map((i) => (i.type === 'agent' ? `agent:${i.event}:${i.text}` : i.type))).toEqual([
        'receipt',
        expect.stringMatching(/^agent:spawn:started on fake for T1 in /),
        'agent:report:finished a turn',
      ])

      const detail = await json(app.request('/api/agents/counter'))
      expect(detail).toMatchObject({ agent: { id: 'counter', task_id: 1 }, task: { id: 1, title: 'Count files' }, lastReport: { text: 'There are 3 files.' } })
      const status = (await json(app.request('/api/chat'))).status
      expect(status.agents).toEqual([expect.objectContaining({ id: 'counter', runtime: 'fake', task: 1 })])

      expect((await post('/api/agents/counter/stop', { remove: true })).status).toBe(200)
      expect((await json(app.request('/api/agents'))).agents).toEqual([])
      expect((await app.request('/api/agents/counter')).status).toBe(404)
    } finally {
      close()
      const { execFileSync } = await import('node:child_process')
      try {
        execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' })
      } catch {}
    }
  })

  it('answers 503 for agent calls when no supervisor runs', async () => {
    const { app, close } = setup()
    expect((await app.request('/api/agents')).status).toBe(503)
    close()
  })
})

describe('static files', () => {
  it('never lets the page go stale, and caches hashed bundles forever', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const web = mkdtempSync(join(tmpdir(), 'majordomo-web-'))
    mkdirSync(join(web, 'assets'))
    writeFileSync(join(web, 'index.html'), '<title>Wednesday</title>')
    writeFileSync(join(web, 'assets', 'index-abc.js'), 'x')
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-srv-'))
    const cfg = loadConfig({ dataDir })
    const { app, close } = createApp({ mem: new Memory(cfg.dbPath), cfg, runner: new GatedRunner(), webRoot: web })
    const page = await app.request('/')
    expect(await page.text()).toContain('Wednesday')
    expect(page.headers.get('cache-control')).toBe('no-cache')
    expect((await app.request('/some/route')).headers.get('cache-control')).toBe('no-cache')
    expect((await app.request('/assets/index-abc.js')).headers.get('cache-control')).toMatch(/immutable/)
    close()
  })
})

describe('pages', () => {
  it('lists tasks, skills and memory, and searches memory', async () => {
    const { mem, app, close } = setup()
    const t = mem.taskCreate({ title: 'Fix login', goal: 'users log in', skill: 'coding' })
    mem.taskUpdate(t.id, { status: 'done', result: 'fixed' })
    mem.taskCreate({ title: 'Ask client', goal: 'g', status: 'waiting_owner' })
    const said = mem.append('owner', 'We host on Hetzner')
    const old = mem.factWrite({ kind: 'decision', subject: 'hosting', body: 'Hetzner', source: `L${said.id}` })
    mem.factWrite({ kind: 'decision', subject: 'hosting', body: 'DigitalOcean', source: 'owner', supersedes: [old.id] })
    mem.nowUpdate('Goal: ship')

    const tasks = (await json(app.request('/api/tasks'))).tasks
    expect(tasks.map((x: { title: string; skill: string | null; agent: unknown }) => [x.title, x.skill, x.agent])).toEqual([
      ['Ask client', null, null],
      ['Fix login', 'coding', null],
    ])
    const skills = (await json(app.request('/api/skills'))).skills
    expect(skills.find((x: { id: string }) => x.id === 'coding')).toMatchObject({ exp: 35, level: 1, recent: [{ amount: 30 }, { amount: 5 }] })
    const memory = await json(app.request('/api/memory'))
    expect(memory.now.text).toBe('Goal: ship')
    expect(memory.facts.map((f: { body: string; stale: boolean }) => [f.body, f.stale])).toEqual([
      ['DigitalOcean', false],
      ['Hetzner', true],
    ])
    const found = await json(app.request('/api/memory?q=Hetzner'))
    expect(found.hits.find((h: { ref: string }) => h.ref === `L${said.id}`).outdated).toMatch(/replaced by/)
    expect((await json(app.request('/api/chat?limit=1'))).status.waiting).toBe(1)
    close()
  })

  it('validates settings and applies them to the next captain turn', async () => {
    const { app, runner, captain, close } = setup()
    const put = (body: unknown) => app.request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await json(app.request('/api/settings'))).settings).toMatchObject({ web: false, sleepAt: '04:00' })
    const bad = await put({ rotateAt: 2, maxTurns: 1, sleepAt: '25:00', model: 'Not A Model!' })
    expect(bad.status).toBe(400)
    expect(Object.keys((await json(bad)).errors).sort()).toEqual(['maxTurns', 'model', 'rotateAt', 'sleepAt'])
    expect((await json(await put({ web: true, maxTurns: 12, sleepAt: '' }))).settings).toMatchObject({ web: true, maxTurns: 12, sleepAt: '' })
    expect((captain as unknown as { cfg: { allowedTools: string[]; maxTurns: number } }).cfg.allowedTools).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']))
    expect((captain as unknown as { cfg: { maxTurns: number } }).cfg.maxTurns).toBe(12)
    expect((await json(await put({ web: false }))).settings.web).toBe(false)
    expect(runner.calls).toHaveLength(0)
    close()
  })
})
