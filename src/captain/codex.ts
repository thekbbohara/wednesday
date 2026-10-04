// Runs one captain turn on the Codex CLI (`codex exec --json`), as the last
// link of the provider chain. Codex picks its own thread ids, so Jarvis's
// session ids are mapped to them in <data>/codex-threads.json. Codex reports
// no context window, so on Codex the captain rotates on its turn cap.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Runner, TurnRequest, TurnResult } from './runner.ts'

export interface CodexRunnerOptions {
  bin: string
  model?: string
  cwd: string
  /** Where the session -> thread map lives. */
  dataDir: string
  timeoutSec: number
}

/** TOML string literal for a `-c key=value` override. */
const toml = (v: string) => JSON.stringify(v)

export class CodexRunner implements Runner {
  private opts: CodexRunnerOptions
  private mapFile: string

  constructor(opts: CodexRunnerOptions) {
    this.opts = opts
    this.mapFile = join(opts.dataDir, 'codex-threads.json')
  }

  private threads(): Record<string, string> {
    try {
      return existsSync(this.mapFile) ? (JSON.parse(readFileSync(this.mapFile, 'utf8')) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private remember(sessionId: string, threadId: string): void {
    const all = this.threads()
    all[sessionId] = threadId
    writeFileSync(this.mapFile, JSON.stringify(all, null, 2))
  }

  run(req: TurnRequest): Promise<TurnResult> {
    const thread = req.resume ? this.threads()[req.sessionId] : undefined
    if (req.resume && !thread) return Promise.resolve({ ...failure('no Codex thread for this session'), sessionMissing: true })

    // The captain's memory tools, passed as config overrides (no user config, no other servers).
    const mcp = Object.entries(req.mcpServers).flatMap(([name, s]) => [
      '-c', `mcp_servers.${name}.command=${toml(s.command)}`,
      '-c', `mcp_servers.${name}.args=[${s.args.map(toml).join(', ')}]`,
      '-c', `mcp_servers.${name}.env={${Object.entries(s.env).map(([k, v]) => `${k}=${toml(v)}`).join(', ')}}`,
    ])
    const common = [
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      // Unattended: auto-run the memory tool calls. This is the one flag both `exec` and
      // `exec resume` accept, and it also drops Codex's sandbox - so a Codex captain can run
      // shell freely. It only runs when the owner adds `codex` to JARVIS_FALLBACKS and Claude
      // is exhausted. See the README note on the Codex fallback.
      '--dangerously-bypass-approvals-and-sandbox',
      ...(this.opts.model ? ['-m', this.opts.model] : []),
      ...mcp,
    ]
    const args = thread ? ['exec', 'resume', ...common, thread, '-'] : ['exec', ...common, '-']
    // Codex has no system-prompt flag: a fresh thread gets it at the top of its first message.
    const input = thread ? req.message : `${req.systemPrompt}\n\n---\n\n${req.message}`

    return new Promise((resolve) => {
      const child = spawn(this.opts.bin, args, { cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), this.opts.timeoutSec * 1000)
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve(failure(`could not start ${this.opts.bin}: ${e.message}`))
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        if (signal) return resolve(failure(`codex turn killed (${signal}) after ${this.opts.timeoutSec}s`))
        const r = parseCodexEvents(out)
        if (r.threadId && !thread) this.remember(req.sessionId, r.threadId)
        if (r.text) return resolve({ text: r.text, contextTokens: r.tokens, contextWindow: null, costUsd: 0, isError: false })
        // Only the reason, never raw logs (stderr can hold unrelated auth noise).
        const reason = r.error || lastLine(err) || `codex exited ${code}`
        resolve({ ...failure(reason.slice(0, 400)), sessionMissing: !!thread && /not found|no such|unknown (session|thread)/i.test(reason) })
      })
      child.stdin.end(input)
    })
  }
}

function failure(text: string): TurnResult {
  return { text, contextTokens: 0, contextWindow: null, costUsd: 0, isError: true }
}

function lastLine(s: string): string {
  return s.trim().split('\n').filter((l) => /error|limit|denied|failed/i.test(l)).at(-1)?.replace(/^\S+\s+ERROR\s+/, '').trim() ?? ''
}

/** Reads `codex exec --json` JSONL: thread id, final agent message, token use, failure reason. Exported for tests. */
export function parseCodexEvents(stdout: string): { threadId: string | null; text: string; tokens: number; error: string } {
  let threadId: string | null = null
  let text = ''
  let tokens = 0
  let error = ''
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let e: { type?: string; thread_id?: string; item?: { type?: string; text?: string; message?: string }; usage?: Record<string, number>; error?: { message?: string }; message?: string }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type === 'thread.started' && e.thread_id) threadId = e.thread_id
    if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) text = e.item.text
    if (e.type === 'turn.completed' && e.usage) tokens = (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0)
    if (e.type === 'turn.failed' || e.type === 'error') error = e.error?.message ?? e.message ?? error
  }
  return { threadId, text, tokens, error }
}
