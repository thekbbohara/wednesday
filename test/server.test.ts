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
  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-srv-'))
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
    mem.taskCreate({ title: 'buy tea', goal: 'restock' })
    mem.append('captain', `Saved [F${f.id}]`)
    const page = await json(app.request('/api/chat'))
    expect(page.items.filter((i: { type: string }) => i.type === 'receipt').map((i: { verb: string; ref: string }) => `${i.verb} ${i.ref}`)).toEqual([
      'saved F1',
      'created T1',
    ])
    expect(await json(app.request('/api/ref/F1'))).toMatchObject({ ref: 'F1', title: 'tea', body: 'ilam green', source: 'L1' })
    expect(await json(app.request('/api/ref/T1'))).toMatchObject({ title: 'buy tea (open)' })
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
    expect(signin.headers.get('set-cookie')).toMatch(/jarvis_token=s3cret; .*HttpOnly/)
    expect((await app.request('/api/chat', { headers: { cookie: 'jarvis_token=s3cret' } })).status).toBe(200)
    close()
  })
})
