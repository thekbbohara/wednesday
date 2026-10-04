// The captain loop: the chat is the ledger, the LLM session is disposable.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from '../config.ts'
import { CLOSED_STATUSES, type LedgerEntry, type Memory, type TaskStatus } from '../memory/store.ts'
import { withFileLock } from './lock.ts'
import { plainDash } from '../text.ts'
import { buildTurnPrompt, handoffPrompt, newView, type SessionView } from './prompt.ts'
import type { Runner, TurnResult } from './runner.ts'
import { isUsageLimit, type Provider } from './provider.ts'

const MCP_SERVER = fileURLToPath(new URL('../mcp/server.ts', import.meta.url))
export const SILENT = /^\s*NOTHING_TO_REPORT\W*$/

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
  private runnerFor: (p: Provider) => Runner
  private runners = new Map<string, Runner>()
  /** Provider the current/next session runs on. */
  private providerId: string
  /** Overridable in tests; cooldown math uses it. */
  clock: () => number = () => Date.now()
  private lockPath: string
  private chain: Promise<unknown> = Promise.resolve()
  private pending: LedgerEntry[] = []
  private draining = false
  onStatus?: (s: { thinking: boolean }) => void
  /** Set by the web server, which runs the agent supervisor: live summary for the prompt, and where the agent tools reach it. */
  agents?: { summary: () => string; url: string; token?: string }

  /** `runnerFor` builds (or returns) the Runner for a provider in the chain. */
  constructor(mem: Memory, cfg: Config, runnerFor: (p: Provider) => Runner) {
    this.mem = mem
    this.cfg = cfg
    this.runnerFor = runnerFor
    this.providerId = cfg.captainChain[0].id
    mkdirSync(cfg.dataDir, { recursive: true })
    this.lockPath = join(cfg.dataDir, 'captain.lock')
  }

  private runnerOf(p: Provider): Runner {
    let r = this.runners.get(p.id)
    if (!r) this.runners.set(p.id, (r = this.runnerFor(p)))
    return r
  }

  // ---- provider chain (failover when one hits its usage limit) -------------

  private cooldowns(): Record<string, number> {
    try {
      return JSON.parse(this.mem.metaGet('captain_cooldowns') ?? '{}') as Record<string, number>
    } catch {
      return {}
    }
  }

  private cooldown(id: string): void {
    const c = this.cooldowns()
    c[id] = this.clock() + this.cfg.limitCooldownMs
    this.mem.metaSet('captain_cooldowns', JSON.stringify(c))
  }

  /** Next provider to try: first in the chain, skipping ones tried this turn and ones cooling down. */
  private pickProvider(tried: Set<string>): Provider | null {
    const chain = this.cfg.captainChain
    const fresh = chain.filter((p) => !tried.has(p.id))
    if (!fresh.length) return null
    const cd = this.cooldowns()
    const ready = fresh.filter((p) => (cd[p.id] ?? 0) <= this.clock())
    if (ready.length) return ready[0]
    // All cooling: try the one closest to recovering (its limit may have reset early).
    return [...fresh].sort((a, b) => (cd[a.id] ?? 0) - (cd[b.id] ?? 0))[0]
  }

  /** If the live session belongs to a different provider, end it so a fresh one starts on `id`. */
  private ensureProvider(provider: Provider): void {
    const cur = this.mem.sessionCurrent()
    if (cur && this.mem.metaGet('captain_session_provider') !== provider.id) {
      this.mem.sessionEnd(cur.id, 'provider switch')
      this.mem.append('rotation', `Captain switched to ${provider.label}`, { session: cur.id, meta: { provider: provider.id } })
      this.view = newView()
      this.viewSession = null
    }
    this.providerId = provider.id
  }

  private systemPrompt(): string {
    return readFileSync(this.cfg.promptFile, 'utf8').replaceAll('{{NAME}}', this.cfg.name)
  }

  private mcpServers(sessionId: string) {
    return {
      jarvis: {
        command: process.execPath,
        args: ['--disable-warning=ExperimentalWarning', MCP_SERVER],
        env: {
          JARVIS_DB: this.cfg.dbPath,
          JARVIS_SESSION: sessionId,
          ...(this.agents ? { JARVIS_URL: this.agents.url } : {}),
          ...(this.agents?.token ? { JARVIS_TOKEN: this.agents.token } : {}),
        } as Record<string, string>,
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
    this.mem.metaSet('captain_session_provider', this.providerId)
    this.mem.append('system', `Captain session ${id} started`, { session: id })
    this.view = newView()
    this.viewSession = id
    return { id, fresh: true }
  }

  private call(runner: Runner, sessionId: string, resume: boolean, message: string): Promise<TurnResult> {
    return runner.run({ sessionId, resume, message, systemPrompt: this.systemPrompt(), mcpServers: this.mcpServers(sessionId) })
  }

  /** Owner message in, reply out (terminal: one message per turn). */
  async handle(text: string): Promise<Reply> {
    return this.respond([this.receive(text)])
  }

  /** Record an owner message in the ledger; it shows in the chat right away. */
  receive(text: string): LedgerEntry {
    return this.mem.append('owner', text)
  }

  /**
   * Queue inputs for the captain: owner messages and agent events. Inputs that
   * arrive while a turn runs are handled together in the next turn, like a
   * person catching up.
   */
  enqueue(...inputs: LedgerEntry[]): void {
    this.pending.push(...inputs)
    if (!this.draining) void this.drain()
  }

  /** Re-run a failed turn from its failure notice. */
  retry(failureId: number): LedgerEntry[] {
    const e = this.mem.ledgerGet(failureId)
    const ids = (e?.meta?.reply_to as number[] | undefined) ?? []
    if (!e || e.kind !== 'system' || !e.meta?.error || !ids.length) throw new Error(`L${failureId} is not a failed turn`)
    const inputs = ids.map((id) => this.mem.ledgerGet(id)).filter((o): o is LedgerEntry => o?.kind === 'owner' || o?.kind === 'agent')
    this.enqueue(...inputs)
    return inputs
  }

  get busy(): boolean {
    return this.draining
  }

  private async drain(): Promise<void> {
    this.draining = true
    this.onStatus?.({ thinking: true })
    try {
      while (this.pending.length) {
        const batch = this.pending.splice(0)
        try {
          await this.respond(batch)
        } catch (e) {
          // respond() ledgers its own failures; this only catches lock or bug errors.
          this.failure(batch, e instanceof Error ? e.message : String(e), null)
        }
      }
    } finally {
      this.draining = false
      this.onStatus?.({ thinking: false })
    }
  }

  /** Run one captain turn handling these inputs (owner messages, agent events). */
  respond(inputs: LedgerEntry[]): Promise<Reply> {
    const run = this.chain.then(() => withFileLock(this.lockPath, (this.cfg.turnTimeout + 120) * 1000, () => this.turn(inputs)))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async turn(inputs: LedgerEntry[]): Promise<Reply> {
    const tried = new Set<string>()
    for (;;) {
      const provider = this.pickProvider(tried)
      if (!provider) {
        const e = this.failure(inputs, 'every captain provider is at its usage limit; try again later', null)
        return { text: e.text.replace(/^Captain turn failed: /, ''), ledgerId: e.id, sessionId: '', contextTokens: 0, contextWindow: null, error: true }
      }
      this.ensureProvider(provider)
      const runner = this.runnerOf(provider)

      let s = this.session()
      let prompt = buildTurnPrompt(this.mem, this.cfg, inputs, this.view, s.id, this.agents?.summary() ?? null)
      let res = await this.call(runner, s.id, !s.fresh, prompt.text)

      if (res.isError && res.sessionMissing) {
        this.mem.append('system', `Captain session ${s.id} is gone (${res.text}); starting fresh`, { session: s.id })
        this.mem.sessionEnd(s.id, 'missing')
        s = this.session()
        prompt = buildTurnPrompt(this.mem, this.cfg, inputs, this.view, s.id, this.agents?.summary() ?? null)
        res = await this.call(runner, s.id, false, prompt.text)
      }

      // Provider at its limit: put it on cooldown and fail over to the next one.
      if (res.isError && isUsageLimit(res.text)) {
        this.cooldown(provider.id)
        this.mem.sessionEnd(s.id, 'provider limit')
        this.mem.append('system', `${provider.label} hit its usage limit; switching provider`, { session: s.id, meta: { provider: provider.id } })
        tried.add(provider.id)
        this.view = newView()
        this.viewSession = null
        continue
      }

      if (res.isError) {
        const e = this.failure(inputs, res.text, s.id)
        if (s.fresh) this.mem.sessionEnd(s.id, 'failed first turn')
        return { text: res.text, ledgerId: e.id, sessionId: s.id, contextTokens: 0, contextWindow: null, error: true }
      }

      res.text = plainDash(res.text)
      // After agent events there is often nothing worth telling the owner.
      const silent = SILENT.test(res.text)
      const reply = this.mem.append('captain', res.text, {
        session: s.id,
        meta: {
          ...(silent ? { silent: true } : {}),
          ...(provider.id !== this.cfg.captainChain[0].id ? { provider: provider.id } : {}),
          reply_to: inputs.map((o) => o.id),
          context_tokens: res.contextTokens,
          context_window: res.contextWindow,
          cost_usd: res.costUsd,
          recalled: prompt.injected,
        },
      })
      this.mem.sessionTurn(s.id, res.contextTokens, res.contextWindow)

      const out: Reply = { text: res.text, ledgerId: reply.id, sessionId: s.id, contextTokens: res.contextTokens, contextWindow: res.contextWindow }
      const reason = this.rotationReason(s.id, inputs[0].id, res)
      if (reason) {
        await this.rotateUnlocked(reason)
        out.rotated = reason
      }
      return out
    }
  }

  private failure(inputs: LedgerEntry[], reason: string, session: string | null): LedgerEntry {
    return this.mem.append('system', `Captain turn failed: ${reason}`, { session, meta: { error: true, reply_to: inputs.map((o) => o.id) } })
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
  rotate(reason: string): Promise<void> {
    const run = this.chain.then(() => withFileLock(this.lockPath, (this.cfg.turnTimeout + 120) * 1000, () => this.rotateUnlocked(reason)))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async rotateUnlocked(reason: string): Promise<void> {
    const cur = this.mem.sessionCurrent()
    if (!cur) return
    if (cur.turns > 0) {
      const pid = this.mem.metaGet('captain_session_provider')
      const provider = this.cfg.captainChain.find((p) => p.id === pid) ?? this.cfg.captainChain[0]
      const res = await this.call(this.runnerOf(provider), cur.id, true, handoffPrompt(reason))
      if (res.isError) this.mem.append('system', `Handoff turn failed: ${res.text}`, { session: cur.id })
    }
    this.mem.sessionEnd(cur.id, reason)
    this.mem.append('rotation', `Captain session ${cur.id} rotated: ${reason}`, { session: cur.id, meta: { reason, turns: cur.turns, peak_tokens: cur.peak_tokens } })
    this.view = newView()
    this.viewSession = null
  }
}
