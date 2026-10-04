// The captain loop: the chat is the ledger, the LLM session is disposable.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Config } from '../config.ts'
import { CLOSED_STATUSES, type Memory, type TaskStatus } from '../memory/store.ts'
import { plainDash } from '../text.ts'
import { buildTurnPrompt, handoffPrompt, newView, type SessionView } from './prompt.ts'
import type { Runner, TurnResult } from './runner.ts'

const MCP_SERVER = fileURLToPath(new URL('../mcp/server.ts', import.meta.url))

export interface Reply {
  text: string
  ledgerId: number
  sessionId: string
  contextTokens: number
  contextWindow: number | null
  /** Set when the session was rotated after this turn. */
  rotated?: string
  error?: boolean
}

export class Captain {
  private view: SessionView = newView()
  private viewSession: string | null = null

  private mem: Memory
  private cfg: Config
  private runner: Runner

  constructor(mem: Memory, cfg: Config, runner: Runner) {
    this.mem = mem
    this.cfg = cfg
    this.runner = runner
  }

  private systemPrompt(): string {
    return readFileSync(this.cfg.promptFile, 'utf8')
  }

  private mcpServers(sessionId: string) {
    return {
      jarvis: {
        command: process.execPath,
        args: ['--disable-warning=ExperimentalWarning', MCP_SERVER],
        env: { JARVIS_DB: this.cfg.dbPath, JARVIS_SESSION: sessionId },
      },
    }
  }

  /** Current session id, or a new one (not yet known to Claude Code). */
  private session(): { id: string; fresh: boolean } {
    const cur = this.mem.sessionCurrent()
    if (cur && cur.turns > 0) {
      if (this.viewSession !== cur.id) {
        // Process restarted mid-session: we no longer know what it saw, so re-show the essentials.
        this.view = newView()
        this.viewSession = cur.id
      }
      return { id: cur.id, fresh: false }
    }
    if (cur) this.mem.sessionEnd(cur.id, 'never used')
    const id = randomUUID()
    this.mem.sessionStart(id)
    this.mem.append('system', `Captain session ${id} started`, { session: id })
    this.view = newView()
    this.viewSession = id
    return { id, fresh: true }
  }

  private call(sessionId: string, resume: boolean, message: string): Promise<TurnResult> {
    return this.runner.run({ sessionId, resume, message, systemPrompt: this.systemPrompt(), mcpServers: this.mcpServers(sessionId) })
  }

  async handle(text: string): Promise<Reply> {
    const owner = this.mem.append('owner', text)
    let s = this.session()
    let prompt = buildTurnPrompt(this.mem, this.cfg, owner, this.view, s.id)
    let res = await this.call(s.id, !s.fresh, prompt.text)

    if (res.isError && res.sessionMissing) {
      this.mem.append('system', `Captain session ${s.id} is gone (${res.text}); starting fresh`, { session: s.id })
      this.mem.sessionEnd(s.id, 'missing')
      s = this.session()
      prompt = buildTurnPrompt(this.mem, this.cfg, owner, this.view, s.id)
      res = await this.call(s.id, false, prompt.text)
    }

    if (res.isError) {
      const e = this.mem.append('system', `Captain turn failed: ${res.text}`, { session: s.id, meta: { reply_to: owner.id } })
      // A session that never completed a turn does not exist on Claude Code's side.
      if (s.fresh) this.mem.sessionEnd(s.id, 'failed first turn')
      return { text: res.text, ledgerId: e.id, sessionId: s.id, contextTokens: 0, contextWindow: null, error: true }
    }

    res.text = plainDash(res.text)
    const reply = this.mem.append('captain', res.text, {
      session: s.id,
      meta: { reply_to: owner.id, context_tokens: res.contextTokens, context_window: res.contextWindow, cost_usd: res.costUsd, recalled: prompt.injected },
    })
    this.mem.sessionTurn(s.id, res.contextTokens, res.contextWindow)

    const out: Reply = { text: res.text, ledgerId: reply.id, sessionId: s.id, contextTokens: res.contextTokens, contextWindow: res.contextWindow }
    const reason = this.rotationReason(s.id, owner.id, res)
    if (reason) {
      await this.rotate(reason)
      out.rotated = reason
    }
    return out
  }

  /** Why this session should end now, or null. */
  rotationReason(sessionId: string, sinceLedgerId: number, res: TurnResult): string | null {
    const cur = this.mem.sessionCurrent()
    const turns = cur?.id === sessionId ? cur.turns : 0
    // A session that starts above the threshold cannot be helped by rotating; that is a budget bug, not a reason to loop.
    if (turns > 1 && res.contextWindow && res.contextTokens >= this.cfg.rotateAt * res.contextWindow) {
      return `context at ${Math.round((100 * res.contextTokens) / res.contextWindow)}% of window`
    }
    const finished = this.mem.ledgerSince(sinceLedgerId, ['task']).find((e) => {
      const to = e.meta?.status as TaskStatus | undefined
      const from = e.meta?.from as TaskStatus | undefined
      return to && from && CLOSED_STATUSES.includes(to) && !CLOSED_STATUSES.includes(from)
    })
    if (finished) return `task T${finished.meta?.task} closed`
    if (turns >= this.cfg.maxTurns) return `${turns} turns in session`
    return null
  }

  /** End the current session after letting it write its handoff into Now. */
  async rotate(reason: string): Promise<void> {
    const cur = this.mem.sessionCurrent()
    if (!cur) return
    if (cur.turns > 0) {
      const res = await this.call(cur.id, true, handoffPrompt(reason))
      if (res.isError) this.mem.append('system', `Handoff turn failed: ${res.text}`, { session: cur.id })
    }
    this.mem.sessionEnd(cur.id, reason)
    this.mem.append('rotation', `Captain session ${cur.id} rotated: ${reason}`, { session: cur.id, meta: { reason, turns: cur.turns, peak_tokens: cur.peak_tokens } })
    this.view = newView()
    this.viewSession = null
  }
}
