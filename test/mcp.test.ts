// The MCP server as Claude Code runs it: a child process over stdio.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Memory } from '../src/memory/store.ts'

const SERVER = fileURLToPath(new URL('../src/mcp/server.ts', import.meta.url))
const db = join(mkdtempSync(join(tmpdir(), 'majordomo-mcp-')), 'memory.db')
let client: Client

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '')
const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args })

beforeAll(async () => {
  new Memory(db).close()
  client = new Client({ name: 'test', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--disable-warning=ExperimentalWarning', SERVER],
      env: { ...process.env, MAJORDOMO_URL: '', MAJORDOMO_TOKEN: '', MAJORDOMO_DB: db, MAJORDOMO_SESSION: 'sess-1' } as Record<string, string>,
    }),
  )
})

afterAll(async () => {
  await client?.close()
})

describe('majordomo MCP server', () => {
  it('lists the captain tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'agent_answer',
        'agent_list',
        'agent_read',
        'agent_send',
        'agent_spawn',
        'agent_stop',
        'captain_engine_set',
        'fact_mark_stale',
        'fact_write',
        'log_decision',
        'memory_get',
        'memory_search',
        'memory_write',
        'now_get',
        'now_update',
        'page_get',
        'page_list',
        'page_update',
        'skill_add',
        'task_create',
        'task_get',
        'task_list',
        'task_update',
      ].sort(),
    )
  })

  it('writes and finds facts, tasks, decisions; stamps the session', async () => {
    expect(text(await call('fact_write', { kind: 'owner', subject: 'owner city', body: 'Kathmandu', source: 'owner' }))).toBe('Saved F1.')
    expect(text(await call('task_create', { title: 'Build memory', goal: 'captain survives rotation', skill: 'coding' }))).toBe('Created T1 (coding).')
    expect((await call('task_create', { title: 'x', goal: 'y', skill: 'juggling' })).isError).toBe(true)
    expect(text(await call('log_decision', { decision: 'Use SQLite FTS5', reason: 'one file, no servers' }))).toMatch(/^Logged L\d+\.$/)
    expect((await call('task_update', { id: 1, status: 'waiting_owner' })).isError).toBe(true)
    expect(text(await call('task_update', { id: 1, status: 'waiting_owner', result: 'Needs owner: approve the $20 plan' }))).toBe('T1 is waiting_owner.')
    expect(text(await call('task_update', { id: 1, status: 'done', result: 'shipped' }))).toBe('T1 is done.')
    const m = new Memory(db)
    expect(m.expBySkill().get('coding')).toBe(35)
    m.close()

    const found = text(await call('memory_search', { query: 'sqlite' }))
    expect(found).toMatch(/L\d+ .*decision: Decision: Use SQLite FTS5/)
    expect(text(await call('memory_search', { query: 'zebra' }))).toMatch(/No matches/)
    expect(text(await call('memory_get', { ids: ['F1', 'T9'] }))).toMatch(/Kathmandu[\s\S]*not found/)

    const mem = new Memory(db)
    expect(mem.ledgerTail(10).filter((e) => e.kind !== 'system').every((e) => e.session === 'sess-1')).toBe(true)
    mem.close()
  })

  it('keeps memory_write as an alias, and searches by keyword when there is no meaning index', async () => {
    expect(text(await call('memory_write', { kind: 'project', subject: 'pc health', body: 'the PC froze under load', source: 'owner' }))).toMatch(/^Saved F\d+\.$/)
    expect(text(await call('memory_search', { query: 'froze', scope: 'facts' }))).toMatch(/pc health/)
  })

  it('creates, lists and reads project pages in a sidecar, never in memory.db', async () => {
    expect(text(await call('page_list'))).toMatch(/No project pages yet/)
    expect((await call('page_update', { slug: 'pc-health', title: 'PC health', keywords: ['ssd'], body: 'freezes [F999]' })).isError).toBe(true)
    expect(text(await call('page_update', { slug: 'pc-health', title: 'PC health', keywords: ['ssd', 'nvme'], body: 'SSD runs hot [F1]' }))).toMatch(/^Page pc-health is v1/)
    expect(text(await call('page_list'))).toMatch(/^pc-health v1 .* PC health \[ssd, nvme\]/)
    expect(text(await call('page_get', { slug: 'pc-health', history: true }))).toMatch(/SSD runs hot \[F1\][^]*v1 .*sess-1: created/)
    expect(existsSync(db.replace(/\.db$/, '-pages.db'))).toBe(true)
    const m = new Memory(db)
    expect(m.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'page%'").all()).toEqual([])
    expect(m.ledgerTail(1, ['page'])[0].text).toBe('Page pc-health v1 (PC health): created')
    m.close()
  })

  it('says plainly that agents need the web server when it is not running', async () => {
    const r = await call('agent_list')
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/web server is not running/)
  })

  it('unlocks a new skill and can tag a task with it in the same session', async () => {
    expect(text(await call('skill_add', { name: 'OSINT', covers: 'open-source research and due diligence' }))).toMatch(/Added skill osint/)
    expect(text(await call('task_create', { title: 'Vendor check', goal: 'due diligence', skill: 'osint' }))).toMatch(/\(osint\)/)
    const dupe = await call('skill_add', { name: 'osint', covers: 'again' })
    expect(dupe.isError).toBe(true)
    expect(text(dupe)).toMatch(/already exists/)
    const mem = new Memory(db)
    expect(mem.ledgerTail(20, ['system']).some((e) => (e.meta?.skill_new as { id?: string } | undefined)?.id === 'osint')).toBe(true)
    expect(mem.expBySkill().get('osint')).toBe(5)
    mem.close()
  })

  it('persists an engine switch without requiring a web server', async () => {
    const r = await call('captain_engine_set', { engine: 'kimi', model: 'kimi-for-coding' })
    expect(r.isError).not.toBe(true)
    expect(JSON.parse(readFileSync(join(db, '..', 'settings.json'), 'utf8'))).toMatchObject({ engine: 'kimi', engineModel: 'kimi-for-coding' })
  })

  it('reports errors as tool errors, not crashes', async () => {
    const r = await call('now_update', { text: 'x'.repeat(9000) })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/budget/)
    const ok = await call('now_update', { text: 'Goal: ship step 1' })
    expect(text(ok)).toMatch(/v1/)
    expect(text(await call('now_get'))).toMatch(/ship step 1/)
  })
})
