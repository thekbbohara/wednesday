// Runs worker agents in tmux and watches them without spending tokens: the
// captain is woken only when something happens that it must act on (a turn
// ended, a prompt needs an answer, an agent died). Lifecycle and screen reading
// follow agent-hq's engine (server/engine/engine.ts).
import { EventEmitter } from 'node:events'
import { mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AgentRow, LedgerEntry, Memory } from '../memory/store.ts'
import { classify, fingerprint, lastLines, readChoices, type Choice, type Mood } from './activity.ts'
import { claudeSettingsArg, turnHookArgs, writeHookScript } from './hooks.ts'
import { loadRuntimes, type Runtime } from './runtimes.ts'
import { Tmux, type PaneInfo } from './tmux.ts'
import { addWorktree, removeWorktree, repoRoot } from './worktree.ts'

export const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/
const CAPTURE_LINES = 60
const REPORT_MAX = 8000

export const DEFAULT_TIMINGS = {
  /** A brief waits for the agent's UI to settle before it is typed in. */
  briefSettleMs: 2500,
  briefGiveUpMs: 90_000,
  /** A prompt must stay on screen this long before the captain is woken for it (menus flicker while drawing). */
  needsStableMs: 2000,
  /** Runtimes without a turn hook: a turn has ended once the screen has been idle this long. */
  idleTurnMs: 4000,
}

export class SupervisorError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export interface SpawnInput {
  id: string
  runtime: string
  brief: string
  task_id?: number | null
  /** A git repo: the agent works in a fresh worktree of it, on its own branch. */
  repo?: string
  /** Or a plain folder to work in, as is. */
  cwd?: string
  branch?: string
  /** Commit or branch the worktree starts from (default: the repo's HEAD). */
  base?: string
}

export interface Live {
  mood: Mood
  reason: string | null
  choices: Choice[] | null
  lastActivityAt: string | null
}

export interface AgentView extends AgentRow, Live {
  session: string
  attach: string
}

export type AgentEventKind = 'spawn' | 'message' | 'answer' | 'auto' | 'report' | 'needs' | 'exit' | 'error' | 'stop'

/** Events the captain must act on. The rest are only recorded. */
const WAKES: ReadonlySet<AgentEventKind> = new Set(['report', 'needs', 'exit', 'error'])

interface Tracker {
  print: string | null
  changedAt: number
  live: Live
  brief: { text: string; startedAt: number } | null
  /** Prompt already escalated, so one prompt wakes the captain once. */
  needsSent: string | null
  needsKey: string | null
  needsSince: number
  /** Death already reported. */
  exitSent: boolean
  /** Hookless runtimes: a turn is in progress. */
  busy: boolean
}

export interface SupervisorOptions {
  mem: Memory
  /** Assistant name, used in agent briefs and messages. */
  name?: string
  dataDir: string
  socket: string
  /** Where agents' turn hooks reach Jarvis. */
  hook: { url: string; token?: string } | null
  pollMs?: number
  timings?: Partial<typeof DEFAULT_TIMINGS>
}

export class Supervisor extends EventEmitter {
  readonly tmux: Tmux
  readonly runtimes: Runtime[]
  private mem: Memory
  private name: string
  private dataDir: string
  private hook: SupervisorOptions['hook']
  private hookScript: string
  private trackers = new Map<string, Tracker>()
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private pollMs: number
  private timings: typeof DEFAULT_TIMINGS

  constructor(opts: SupervisorOptions) {
    super()
    this.mem = opts.mem
    this.name = opts.name ?? 'Jarvis'
    this.dataDir = opts.dataDir
    this.hook = opts.hook
    this.tmux = new Tmux(opts.socket)
    this.runtimes = loadRuntimes(opts.dataDir)
    this.hookScript = writeHookScript(opts.dataDir)
    this.pollMs = opts.pollMs ?? 1500
    this.timings = { ...DEFAULT_TIMINGS, ...opts.timings }
  }

  start(): void {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.pollMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  static session(id: string): string {
    return `jarvis_${id}`
  }

  // ---------- reads ----------

  list(): AgentView[] {
    return this.mem.agentList().map((a) => this.view(a))
  }

  get(id: string): AgentView {
    return this.view(this.find(id))
  }

  /** One line per agent, for the captain's prompt. */
  summary(): string {
    return this.list()
      .map((a) => {
        const where = a.branch ? `branch ${a.branch}` : a.cwd
        const task = a.task_id ? ` T${a.task_id}` : ''
        const why = a.mood === 'needs' && a.reason ? ` (${a.reason})` : ''
        return `${a.id} [${a.mood}${why}] ${a.runtime}${task} - ${where}`
      })
      .join('\n')
  }

  async screen(id: string, lines = 120): Promise<string> {
    const a = this.find(id)
    if (a.status !== 'running') return ''
    return this.tmux.capture(Supervisor.session(id), lines).catch(() => '')
  }

  private view(a: AgentRow): AgentView {
    const t = this.trackers.get(a.id)
    const live: Live =
      a.status !== 'running'
        ? { mood: 'offline', reason: a.status, choices: null, lastActivityAt: t?.live.lastActivityAt ?? null }
        : (t?.live ?? { mood: 'offline', reason: 'not seen yet', choices: null, lastActivityAt: null })
    const session = Supervisor.session(a.id)
    return { ...a, ...live, session, attach: `tmux -L ${this.tmux.socket} attach -t ${session}` }
  }

  private find(id: string): AgentRow {
    const a = this.mem.agentGet(id)
    if (!a || a.status === 'removed') throw new SupervisorError(`No agent "${id}"`, 404)
    return a
  }

  private runtime(id: string): Runtime {
    const r = this.runtimes.find((x) => x.id === id)
    if (!r) throw new SupervisorError(`Unknown runtime "${id}". Known: ${this.runtimes.map((x) => x.id).join(', ')}`)
    return r
  }

  private record(agent: string, event: AgentEventKind, text: string, meta: Record<string, unknown> = {}): LedgerEntry {
    const entry = this.mem.append('agent', text, { meta: { agent, event, ...meta } })
    this.emit('event', entry, WAKES.has(event))
    return entry
  }

  // ---------- lifecycle ----------

  async spawn(input: SpawnInput): Promise<AgentView> {
    const id = input.id?.trim()
    if (!AGENT_ID.test(id ?? '')) throw new SupervisorError('Agent name must be lowercase letters, digits and dashes, starting with a letter (max 32)')
    if (this.mem.agentGet(id)) throw new SupervisorError(`An agent named "${id}" already exists or existed; pick another name`, 409)
    const runtime = this.runtime(input.runtime)
    const brief = input.brief?.trim()
    if (!brief) throw new SupervisorError('A brief is required: what the agent should do')
    const task = input.task_id ? this.mem.taskGet(input.task_id) : null
    if (input.task_id && !task) throw new SupervisorError(`No task T${input.task_id}`)
    if (!!input.repo === !!input.cwd) throw new SupervisorError('Give exactly one of repo (code work, in a fresh git worktree) or cwd (a folder to work in as is)')

    let cwd: string
    let repo: string | null = null
    let branch: string | null = null
    if (input.repo) {
      repo = await repoRoot(expand(input.repo))
      if (!repo) throw new SupervisorError(`Not a git repo: ${input.repo}`)
      branch = input.branch?.trim() || `jarvis/${id}`
      cwd = join(this.dataDir, 'worktrees', id)
      mkdirSync(join(this.dataDir, 'worktrees'), { recursive: true })
      try {
        await addWorktree(repo, cwd, branch, input.base)
      } catch (e) {
        throw new SupervisorError(`Could not create the worktree: ${(e as Error).message}`)
      }
    } else {
      cwd = expand(input.cwd!)
      if (!isDir(cwd)) throw new SupervisorError(`Not a folder: ${cwd}`)
    }

    const row = this.mem.agentCreate({ id, task_id: task?.id ?? null, runtime: runtime.id, cwd, repo, branch, brief })
    try {
      await this.launch(row, runtime, composeBrief(row, task?.title ?? null, this.name))
    } catch (e) {
      this.mem.agentSetStatus(id, 'stopped')
      this.record(id, 'error', `${id} failed to start: ${(e as Error).message}`)
      throw new SupervisorError(`Could not start ${id}: ${(e as Error).message}`, 500)
    }
    const where = branch ? ` in a fresh worktree on ${branch}` : ` in ${cwd}`
    this.record(id, 'spawn', `${id} started on ${runtime.label}${task ? ` for T${task.id}` : ''}${where}`, { task: task?.id ?? null })
    return this.get(id)
  }

  private async launch(a: AgentRow, runtime: Runtime, brief: string): Promise<void> {
    const session = Supervisor.session(a.id)
    await this.tmux.kill(session)
    const env: Record<string, string> = { JARVIS_AGENT: a.id }
    let command = runtime.command
    if (runtime.turnHook === 'claude') command += claudeSettingsArg(this.hook ? this.hookScript : null)
    else if (runtime.turnHook && this.hook) command += turnHookArgs(runtime.turnHook, this.hookScript)
    if (this.hook && runtime.turnHook) {
      env.JARVIS_URL = this.hook.url
      if (this.hook.token) env.JARVIS_TOKEN = this.hook.token
    }
    await this.tmux.start(session, a.cwd, command, env)
    this.trackers.set(a.id, {
      print: null,
      changedAt: Date.now(),
      live: { mood: 'working', reason: 'starting', choices: null, lastActivityAt: new Date().toISOString() },
      brief: { text: brief, startedAt: Date.now() },
      needsSent: null,
      needsKey: null,
      needsSince: 0,
      exitSent: false,
      busy: false,
    })
  }

  /** Types a message into the agent, as its next instruction. */
  async send(id: string, text: string): Promise<void> {
    const a = this.find(id)
    const t = this.trackers.get(id)
    if (a.status !== 'running' || !t || t.live.mood === 'offline' || t.live.mood === 'error') throw new SupervisorError(`${id} is not running`, 409)
    if (!text.trim()) throw new SupervisorError('Message is empty')
    await this.tmux.sendText(Supervisor.session(id), text)
    markSent(t)
    this.record(id, 'message', `${this.name} to ${id}: ${text.length > 600 ? `${text.slice(0, 597)}...` : text}`)
  }

  /**
   * Answers the menu on screen by option label. Reads the screen again first,
   * so a stale label can never confirm a different option.
   */
  async answer(id: string, label: string, auto = false): Promise<void> {
    this.find(id)
    const session = Supervisor.session(id)
    const choices = readChoices(await this.tmux.capture(session, CAPTURE_LINES))
    if (!choices) throw new SupervisorError(`${id} has no menu on screen`, 409)
    const target = choices.findIndex((c) => c.label === label)
    if (target < 0) throw new SupervisorError(`"${label}" is not an option. Options: ${choices.map((c) => c.label).join(' | ')}`, 409)
    const steps = target - choices.findIndex((c) => c.selected)
    for (let i = 0; i < Math.abs(steps); i++) await this.tmux.sendKeys(session, steps > 0 ? 'Down' : 'Up')
    await this.tmux.sendKeys(session, 'Enter')
    const t = this.trackers.get(id)
    if (t) {
      t.needsSent = null
      markSent(t)
    }
    this.record(id, auto ? 'auto' : 'answer', auto ? `${this.name} accepted ${id}'s prompt: ${label}` : `${this.name} answered ${id}: ${label}`)
  }

  async interrupt(id: string): Promise<void> {
    const a = this.find(id)
    await this.tmux.sendKeys(Supervisor.session(id), ...this.runtime(a.runtime).interrupt)
  }

  /** Stops the agent. `remove` also deletes its worktree (refused with uncommitted changes; the branch stays). */
  async stopAgent(id: string, remove = false): Promise<AgentView> {
    const a = this.find(id)
    await this.tmux.kill(Supervisor.session(id))
    if (a.status === 'running') this.mem.agentSetStatus(id, 'stopped')
    const t = this.trackers.get(id)
    if (t) t.exitSent = true
    if (remove) {
      if (a.repo) {
        try {
          await removeWorktree(a.repo, a.cwd)
        } catch (e) {
          this.record(id, 'stop', `${id} stopped; worktree kept: ${(e as Error).message.split('\n')[0]}`)
          throw new SupervisorError(`${id} is stopped, but its worktree was kept: ${(e as Error).message}`, 409)
        }
      }
      this.mem.agentSetStatus(id, 'removed')
      this.trackers.delete(id)
      this.record(id, 'stop', `${id} removed${a.repo ? ` (branch ${a.branch} kept)` : ''}`)
    } else {
      this.record(id, 'stop', `${id} stopped`)
    }
    return this.view(this.mem.agentGet(id)!)
  }

  /** What an agent said at the end of its turn, from its turn hook. */
  report(id: string, message: string): LedgerEntry | null {
    const a = this.mem.agentGet(id)
    const text = message.trim()
    if (!a || a.status === 'removed' || !text) return null
    const t = this.trackers.get(id)
    if (t) t.busy = false
    return this.record(id, 'report', `${id} reported:\n${text.length > REPORT_MAX ? `${text.slice(0, REPORT_MAX - 3)}...` : text}`)
  }

  // ---------- polling ----------

  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const running = this.mem.agentList().filter((a) => a.status === 'running')
      if (!running.length) return
      const panes = await this.tmux.panes()
      const now = Date.now()
      for (const a of running) await this.sample(a, panes.get(Supervisor.session(a.id)), now)
    } catch (err) {
      console.error('agent poll failed:', (err as Error).message)
    } finally {
      this.polling = false
    }
  }

  private async sample(a: AgentRow, pane: PaneInfo | undefined, now: number): Promise<void> {
    let t = this.trackers.get(a.id)
    if (!t) {
      // Jarvis restarted while the agent kept running: pick it up as it is.
      t = {
        print: null,
        changedAt: 0,
        live: { mood: 'idle', reason: null, choices: null, lastActivityAt: null },
        brief: null,
        needsSent: null,
        needsKey: null,
        needsSince: 0,
        exitSent: false,
        busy: false,
      }
      this.trackers.set(a.id, t)
    }

    if (!pane || pane.dead) {
      const failed = !!pane && !!pane.exitCode
      t.live = { mood: failed ? 'error' : 'offline', reason: !pane ? 'session gone' : failed ? `exited with code ${pane.exitCode}` : 'exited', choices: null, lastActivityAt: t.live.lastActivityAt }
      t.brief = null
      if (!t.exitSent) {
        t.exitSent = true
        this.mem.agentSetStatus(a.id, 'stopped')
        this.record(a.id, failed ? 'error' : 'exit', `${a.id} ${t.live.reason}`)
      }
      return
    }

    const screen = await this.tmux.capture(Supervisor.session(a.id), CAPTURE_LINES).catch(() => '')
    const print = fingerprint(screen)
    if (print !== t.print) {
      if (t.print !== null) {
        t.changedAt = now
        t.live.lastActivityAt = new Date(now).toISOString()
      }
      t.print = print
    }
    const verdict = classify({ human: false, dead: false, exitCode: null, command: pane.command, screen, sinceChange: t.changedAt ? now - t.changedAt : Infinity })
    const choices = verdict.mood === 'needs' ? readChoices(screen) : null
    t.live = { mood: verdict.mood, reason: verdict.reason, choices, lastActivityAt: t.live.lastActivityAt }

    if (verdict.mood === 'needs') await this.onNeeds(a, t, screen, now)
    else {
      t.needsKey = null
      t.needsSent = null
    }
    await this.deliverBrief(a, t, now)

    // No turn hook (the runtime has none, or Jarvis has no URL for it): a turn ends when the agent has gone quiet.
    const runtime = this.runtimes.find((r) => r.id === a.runtime)
    if (!(runtime?.turnHook && this.hook) && !t.brief) {
      if (verdict.mood === 'working') t.busy = true
      else if (verdict.mood === 'idle' && t.busy && now - t.changedAt >= this.timings.idleTurnMs) {
        t.busy = false
        this.record(a.id, 'report', `${a.id} finished a turn. Its screen:\n${lastLines(screen, 40)}`, { from: 'screen' })
      }
    }
  }

  private async onNeeds(a: AgentRow, t: Tracker, screen: string, now: number): Promise<void> {
    const key = `${t.live.reason}|${JSON.stringify(t.live.choices)}`
    if (key !== t.needsKey) {
      t.needsKey = key
      t.needsSince = now
    }
    if (t.needsSent === key || now - t.needsSince < this.timings.needsStableMs) return
    t.needsSent = key
    // The folder-trust prompt for a worktree Jarvis made itself is not a decision for anyone.
    const trust = t.live.reason === 'trust prompt' && a.repo ? t.live.choices?.find((c) => /\btrust\b|^yes\b/i.test(c.label) && !/^no\b/i.test(c.label)) : null
    if (trust) {
      try {
        await this.answer(a.id, trust.label, true)
        return
      } catch {
        // fall through and ask
      }
    }
    const options = t.live.choices ? `\n\nOptions: ${t.live.choices.map((c) => c.label).join(' | ')}` : ''
    this.record(a.id, 'needs', `${a.id} needs an answer (${t.live.reason}). Its screen:\n${lastLines(screen, 15)}${options}`, {
      reason: t.live.reason,
      choices: t.live.choices?.map((c) => c.label) ?? null,
    })
  }

  /** Types the brief in once the agent's UI has settled at its prompt. */
  private async deliverBrief(a: AgentRow, t: Tracker, now: number): Promise<void> {
    if (!t.brief) return
    const age = now - t.brief.startedAt
    if (age > this.timings.briefGiveUpMs) {
      t.brief = null
      this.record(a.id, 'error', `${a.id} never reached its prompt, so its brief was not delivered. It is ${t.live.mood}${t.live.reason ? ` (${t.live.reason})` : ''}.`)
      return
    }
    if (t.live.mood !== 'idle' || now - t.changedAt < this.timings.briefSettleMs || age < this.timings.briefSettleMs) return
    const text = t.brief.text
    t.brief = null
    try {
      await this.tmux.sendText(Supervisor.session(a.id), text)
      markSent(t)
    } catch (err) {
      this.record(a.id, 'error', `${a.id}: brief failed: ${(err as Error).message}`)
    }
  }
}

/** Input was just given: a turn starts now, so quiet time counts from here, not from the last screen change. */
function markSent(t: Tracker): void {
  t.busy = true
  t.changedAt = Date.now()
}

/** The first message a worker gets. */
export function composeBrief(a: Pick<AgentRow, 'id' | 'task_id' | 'cwd' | 'branch' | 'brief'>, taskTitle: string | null, name = 'Jarvis'): string {
  const task = a.task_id ? ` (task T${a.task_id}${taskTitle ? `: ${taskTitle}` : ''})` : ''
  const where = a.branch
    ? `You are in a fresh git worktree made for this job, on branch ${a.branch}. Commit your work there. Do not push, merge or open a PR unless the job says so.`
    : `Work in ${a.cwd}.`
  return [
    `You are "${a.id}", a worker agent. ${name}, the owner's assistant, gave you this job${task}:`,
    a.brief,
    where,
    `When you finish, or need a decision, end your turn with a short report: what you did, how you verified it, and what you need. ${name} reads only your final message of each turn.`,
  ].join('\n\n')
}

function expand(p: string): string {
  return resolve(p.trim().replace(/^~(?=$|\/)/, homedir()))
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

