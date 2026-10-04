// Runs one captain turn as a headless Claude Code call.
// Headless (`claude -p`) over an interactive tmux session because each call
// returns exact token usage and the context window, so rotation is measured,
// not guessed from the screen; and rotating is just "stop resuming".
import { spawn } from 'node:child_process'

export interface TurnRequest {
  sessionId: string
  /** false: start the session with this id; true: continue it. */
  resume: boolean
  message: string
  systemPrompt: string
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
}

export interface TurnResult {
  text: string
  /** Tokens in context after this turn (what the next turn starts from). */
  contextTokens: number
  contextWindow: number | null
  costUsd: number
  isError: boolean
  /** The session id was unknown to Claude Code (deleted, other machine). */
  sessionMissing?: boolean
}

export interface Runner {
  run(req: TurnRequest): Promise<TurnResult>
}

export interface ClaudeRunnerOptions {
  bin: string
  /** A value, or a getter so settings changed at runtime apply to the next turn. */
  model: string | (() => string)
  cwd: string
  allowedTools: string[] | (() => string[])
  timeoutSec: number
}

export class ClaudeRunner implements Runner {
  private opts: ClaudeRunnerOptions

  constructor(opts: ClaudeRunnerOptions) {
    this.opts = opts
  }

  run(req: TurnRequest): Promise<TurnResult> {
    const model = typeof this.opts.model === 'function' ? this.opts.model() : this.opts.model
    const allowed = typeof this.opts.allowedTools === 'function' ? this.opts.allowedTools() : this.opts.allowedTools
    const builtins = [...new Set(allowed.map((t) => t.replace(/\(.*$/, '')))]
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', model,
      // The captain's context is ours alone: no user/project CLAUDE.md, hooks or plugins.
      '--setting-sources', '',
      '--strict-mcp-config',
      '--mcp-config', JSON.stringify({ mcpServers: req.mcpServers }),
      '--system-prompt', req.systemPrompt,
      '--tools', builtins.length ? builtins.join(',') : '',
      '--allowedTools', [...Object.keys(req.mcpServers).map((s) => `mcp__${s}`), ...allowed].join(','),
      ...(req.resume ? ['--resume', req.sessionId] : ['--session-id', req.sessionId]),
    ]
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
        if (signal) return resolve(failure(`captain turn killed (${signal}) after ${this.opts.timeoutSec}s`))
        const parsed = parseResult(out)
        if (parsed) return resolve(parsed)
        const msg = (err || out).trim()
        resolve({ ...failure(`claude exited ${code}: ${msg.slice(0, 500)}`), sessionMissing: /No conversation found/i.test(msg) })
      })
      child.stdin.end(req.message)
    })
  }
}

function failure(text: string): TurnResult {
  return { text, contextTokens: 0, contextWindow: null, costUsd: 0, isError: true }
}

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Parse `claude -p --output-format json` output. Exported for tests. */
export function parseResult(stdout: string): TurnResult | null {
  let d: {
    result?: string
    is_error?: boolean
    total_cost_usd?: number
    usage?: Usage & { iterations?: Usage[] }
    modelUsage?: Record<string, { contextWindow?: number }>
  }
  try {
    d = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  if (typeof d !== 'object' || d === null || !('result' in d || 'usage' in d)) return null
  // Each iteration is one API call; the last one holds the full context of the turn.
  const its = d.usage?.iterations
  const last: Usage = its?.length ? its[its.length - 1] : (d.usage ?? {})
  const contextTokens =
    (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) + (last.output_tokens ?? 0)
  const windows = Object.values(d.modelUsage ?? {})
    .map((m) => m.contextWindow ?? 0)
    .filter((n) => n > 0)
  return {
    text: d.result ?? '',
    contextTokens,
    contextWindow: windows.length ? Math.max(...windows) : null,
    costUsd: d.total_cost_usd ?? 0,
    isError: Boolean(d.is_error),
  }
}
