import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { AGY_CAPTAIN_MODEL } from '../engines.ts'
import { isUsageLimit } from './provider.ts'
import type { Runner, TurnRequest, TurnResult } from './runner.ts'

export interface AgyRunnerOptions { bin: string; model?: string; dataDir: string; timeoutSec: number }
const failure = (text: string, sessionMissing = false): TurnResult => ({ text, sessionMissing, isError: true, contextTokens: 0, contextWindow: null, costUsd: 0 })
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

/** CLI-owned conversation ids are separate from Majordomo memory sessions. */
export class AgyRunner implements Runner {
  private opts: AgyRunnerOptions
  constructor(opts: AgyRunnerOptions) { this.opts = opts }

  /** Generates only session-local config. No global settings or credentials are copied. */
  prepare(req: TurnRequest): { cwd: string; agent: string; mapFile: string; args: string[] } {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(req.sessionId)) throw new Error('Invalid captain session id')
    const cwd = join(this.opts.dataDir, 'agy-captain', req.sessionId)
    const agent = `majordomo-captain-${req.sessionId}`
    const folder = join(cwd, '.agents', 'agents', agent)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const spec = {
      name: agent, description: 'Majordomo captain with its memory and worker tools',
      mainAgent: true, subagent: false, inheritCustomizations: false, inheritMcp: false,
      excludeDefaultComponents: true, tools: [], commandExecutionPolicy: 'off',
      mcpServers: Object.entries(req.mcpServers).map(([serverName, server]) => ({ serverName, ...server })),
    }
    writeFileSync(join(folder, 'agent.md'), `---\n${JSON.stringify(spec)}\n---\n# System Prompt\n${req.systemPrompt}\n`, { mode: 0o600 })
    return { cwd, agent, mapFile: join(cwd, 'conversation.json'), args: [
      '--agent', agent, '--model', this.opts.model || AGY_CAPTAIN_MODEL,
      '--output-format', 'json', '--print-timeout', `${this.opts.timeoutSec}s`,
      // Only the explicitly attached memory/worker MCP tools can execute.
      '--dangerously-skip-permissions', '--disable-slash-commands',
      `--print=${req.message}`,
    ] }
  }

  async run(req: TurnRequest): Promise<TurnResult> {
    let spec: ReturnType<AgyRunner['prepare']>
    try { spec = this.prepare(req) } catch { return failure('Could not prepare Antigravity captain configuration.') }
    let conversation: string | undefined
    if (req.resume) {
      try { conversation = JSON.parse(readFileSync(spec.mapFile, 'utf8')).conversationId } catch { /* no map */ }
      if (!conversation || !UUID.test(conversation)) return failure('No Antigravity conversation for this session.', true)
      spec.args.push('--conversation', conversation)
    }
    return new Promise(resolve => {
      const child = spawn(this.opts.bin, spec.args, { cwd: spec.cwd, env: { ...process.env, AGY_CLI_HIDE_ACCOUNT_INFO: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = '', timedOut = false, oversized = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, this.opts.timeoutSec * 1000 + 1000)
      let killTimer: ReturnType<typeof setTimeout> | undefined
      child.on('spawn', () => {
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.opts.timeoutSec * 1000 + 6000)
      })
      const clear = () => { clearTimeout(timer); clearTimeout(killTimer) }
      child.stdout.on('data', d => {
        if (stdout.length + d.length > 4 * 1024 * 1024) { oversized = true; child.kill('SIGTERM') }
        else stdout += d
      })
      child.stderr.on('data', d => { stderr = (stderr + d).slice(-16_000) })
      child.on('error', () => { clear(); resolve(failure('Could not start Antigravity CLI; verify its installation and existing login.')) })
      child.on('close', (code, signal) => {
        clear()
        if (timedOut || signal || oversized) return resolve(failure(oversized ? 'Antigravity output exceeded the safe limit.' : 'Antigravity captain turn timed out or was interrupted.'))
        // Missing conversations can otherwise silently fall back to a fresh one.
        if (req.resume && /conversation.*(?:not found|unknown|could not|failed to load)|no.*conversation/i.test(stderr)) return resolve(failure('Antigravity conversation is missing.', true))
        const parsed = parseAgyResult(stdout)
        if (parsed?.result.isError) return resolve(parsed.result)
        if (!parsed || code !== 0) return resolve(failure(isUsageLimit(stderr) ? 'Antigravity usage limit reached.' : 'Antigravity CLI failed or returned unsupported JSON.'))
        if (!parsed.conversationId || !UUID.test(parsed.conversationId) || (conversation && parsed.conversationId !== conversation)) return resolve(failure('Antigravity returned no matching conversation id.', !!conversation))
        try {
          writeFileSync(`${spec.mapFile}.tmp`, JSON.stringify({ conversationId: parsed.conversationId }), { mode: 0o600 })
          renameSync(`${spec.mapFile}.tmp`, spec.mapFile)
        } catch { return resolve(failure('Could not save the Antigravity conversation mapping.')) }
        resolve(parsed.result)
      })
    })
  }
}

export function parseAgyResult(stdout: string): { conversationId: string | null; result: TurnResult } | null {
  let d: any
  try { d = JSON.parse(stdout) } catch { return null }
  if (!d || typeof d !== 'object' || typeof d.status !== 'string' || typeof d.response !== 'string') return null
  const conversationId = typeof d.conversation_id === 'string' ? d.conversation_id : null
  if (d.status !== 'SUCCESS') return { conversationId, result: failure(isUsageLimit(d.response) ? 'Antigravity usage limit reached.' : 'Antigravity captain turn failed.') }
  // Aggregate token usage is not the context size. The CLI reports no reliable
  // context window or dollar cost; retain turn-cap rotation rather than guessing.
  return { conversationId, result: { text: d.response, isError: false, contextTokens: 0, contextWindow: null, costUsd: 0 } }
}
