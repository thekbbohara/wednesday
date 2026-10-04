// UI development and browser checks without spending tokens: the real server
// with a scripted captain that writes memory and cites it.
//   JARVIS_DATA_DIR=/tmp/jarvis-demo node test/demo-server.ts
import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { createApp } from '../src/server.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

const cfg = loadConfig()
const mem = new Memory(cfg.dbPath)
const delay = Number(process.env.DEMO_DELAY_MS ?? 1500)

class DemoRunner implements Runner {
  async run(req: TurnRequest): Promise<TurnResult> {
    const msgs = [...req.message.matchAll(/<owner_message[^>]*>\n([\s\S]*?)\n<\/owner_message>/g)].map((m) => m[1])
    const last = msgs.at(-1) ?? ''
    const ok = (text: string): TurnResult => ({ text, contextTokens: 9000, contextWindow: 200000, costUsd: 0, isError: false })
    await new Promise((r) => setTimeout(r, delay / 2))
    if (req.message.includes('Session rotation')) return ok('handoff saved')
    if (/fail/i.test(last)) return { ...ok('claude exited 1: API overloaded, try again'), isError: true }
    if (/remember|note|decid/i.test(last)) {
      const f = mem.factWrite({ kind: 'preference', subject: 'demo note', body: last.slice(0, 200), source: 'owner' }, req.sessionId)
      await new Promise((r) => setTimeout(r, delay / 2))
      const t = mem.taskCreate({ title: 'Follow up on the note', goal: 'Act on what the owner asked to remember' }, req.sessionId)
      mem.nowUpdate(`Goal: demo. Open: T${t.id}.`, req.sessionId)
      return ok(`Saved it [F${f.id}] and opened a task to follow up [T${t.id}].\n\n- one\n- two\n\n\`\`\`sh\npnpm test\n\`\`\``)
    }
    await new Promise((r) => setTimeout(r, delay / 2))
    return ok(msgs.length > 1 ? `Got your ${msgs.length} messages. Latest: "${last}"` : `You said: ${last}. I have nothing on that yet [L1].`)
  }
}

// DEMO_AGENTS=1 fills the strip with fake agents whose state changes every few seconds.
const states = ['idle', 'working', 'needs', 'error', 'offline'] as const
const demoAgents = () =>
  process.env.DEMO_AGENTS === '1'
    ? [
        { id: 'scraper', name: 'scraper', runtime: 'claude-code' },
        { id: 'reviewer', name: 'reviewer', runtime: 'codex' },
        { id: 'writer', name: 'writer', runtime: 'pi' },
        { id: 'tester', name: 'tester', runtime: 'opencode' },
      ].map((a, i) => ({ ...a, state: states[(i + Math.floor(Date.now() / 4000)) % states.length] }))
    : []

const { app } = createApp({ mem, cfg, runner: new DemoRunner(), agents: demoAgents, webRoot: resolve(import.meta.dirname, '../dist') })
const port = Number(process.env.PORT || 4788)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`demo on http://127.0.0.1:${port} (${cfg.dbPath})`))
