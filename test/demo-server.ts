// UI development and browser checks without spending tokens: the real server
// and agent supervisor, with a scripted captain and scripted agents.
//   JARVIS_DATA_DIR=/tmp/jarvis-demo node test/demo-server.ts
// In the chat: "remember ..." writes memory, "fail" fails a turn,
// "spawn <name>" starts a fake agent, "ask <name>" starts one that shows a menu.
import { serve } from '@hono/node-server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { createApp } from '../src/server.ts'
import { Supervisor } from '../src/agents/supervisor.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

const cfg = loadConfig()
mkdirSync(cfg.dataDir, { recursive: true })
const FIX = resolve(import.meta.dirname, '../src/agents/fixtures')
writeFileSync(
  join(cfg.dataDir, 'runtimes.json'),
  JSON.stringify([
    { id: 'claude-code', command: `bash ${join(FIX, 'fake-agent.sh')}` },
    { id: 'codex', command: `bash ${join(FIX, 'menu.sh')}` },
  ]),
)
const mem = new Memory(cfg.dbPath)
const delay = Number(process.env.DEMO_DELAY_MS ?? 1500)
const port = Number(process.env.PORT || 4788)
const selfUrl = `http://127.0.0.1:${port}`
const sup = new Supervisor({ mem, dataDir: cfg.dataDir, socket: 'jarvis-demo', hook: null })
sup.start()

class DemoRunner implements Runner {
  async run(req: TurnRequest): Promise<TurnResult> {
    const msgs = [...req.message.matchAll(/<owner_message[^>]*>\n([\s\S]*?)\n<\/owner_message>/g)].map((m) => m[1])
    const events = [...req.message.matchAll(/<agent_event[^>]*agent="([^"]+)" event="([^"]+)"/g)]
    const last = msgs.at(-1) ?? ''
    const ok = (text: string): TurnResult => ({ text, contextTokens: 9000, contextWindow: 200000, costUsd: 0, isError: false })
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    await wait(delay / 2)
    if (req.message.includes('Session rotation')) return ok('handoff saved')
    if (!msgs.length && events.length) {
      const [, agent, event] = events.at(-1)!
      return event === 'report' && Math.random() < 0.5 ? ok('NOTHING_TO_REPORT') : ok(`${agent} sent a ${event}; I checked it and it looks fine.`)
    }
    if (/fail/i.test(last)) return { ...ok('claude exited 1: API overloaded, try again'), isError: true }
    const spawn = /^(spawn|ask) ([a-z][a-z0-9-]*)/i.exec(last)
    if (spawn) {
      const t = mem.taskCreate({ title: `Demo job for ${spawn[2]}`, goal: 'Show the agent UI' }, req.sessionId)
      try {
        await sup.spawn({ id: spawn[2], runtime: spawn[1] === 'ask' ? 'codex' : 'claude-code', cwd: cfg.dataDir, brief: `Demo job ${spawn[2]}`, task_id: t.id })
        return ok(`Started **${spawn[2]}** on it [T${t.id}]. I'll tell you when it reports.`)
      } catch (e) {
        return ok(`Could not start it: ${(e as Error).message}`)
      }
    }
    if (/remember|note|decid/i.test(last)) {
      const f = mem.factWrite({ kind: 'preference', subject: 'demo note', body: last.slice(0, 200), source: 'owner' }, req.sessionId)
      await wait(delay / 2)
      const t = mem.taskCreate({ title: 'Follow up on the note', goal: 'Act on what the owner asked to remember' }, req.sessionId)
      mem.nowUpdate(`Goal: demo. Open: T${t.id}.`, req.sessionId)
      return ok(`Saved it [F${f.id}] and opened a task to follow up [T${t.id}].\n\n- one\n- two\n\n\`\`\`sh\npnpm test\n\`\`\``)
    }
    await wait(delay / 2)
    return ok(msgs.length > 1 ? `Got your ${msgs.length} messages. Latest: "${last}"` : `You said: ${last}. I have nothing on that yet [L1].`)
  }
}

const { app } = createApp({ mem, cfg, runner: new DemoRunner(), supervisor: sup, selfUrl, webRoot: resolve(import.meta.dirname, '../dist') })
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`demo on ${selfUrl} (${cfg.dbPath})`))
