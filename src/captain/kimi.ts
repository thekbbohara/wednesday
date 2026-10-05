import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimes } from '../agents/runtimes.ts'
import type { Runner, TurnRequest, TurnResult } from './runner.ts'

/** Kimi uses a dedicated home and workspace per captain session. */
export class KimiRunner implements Runner {
  private opts: { dataDir: string; model?: string; timeoutSec: number }
  constructor(opts: { dataDir: string; model?: string; timeoutSec: number }) {
    this.opts = opts
  }

  run(req: TurnRequest): Promise<TurnResult> {
    const home = join(this.opts.dataDir, 'kimi-captain')
    const cwd = join(home, 'sessions-work', req.sessionId)
    mkdirSync(cwd, { recursive: true })
    // Reuse authentication, but isolate MCP configuration, instructions and sessions.
    const source = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code')
    for (const name of ['config.toml', 'credentials', 'oauth']) {
      if (existsSync(join(source, name))) cpSync(join(source, name), join(home, name), { recursive: true })
    }
    writeFileSync(join(home, 'mcp.json'), JSON.stringify({ mcpServers: req.mcpServers }))
    const command = loadRuntimes(this.opts.dataDir).find((r) => r.id === 'kimi')!.command
    // Prompt mode is already noninteractive; Kimi rejects --auto/--yolo with --prompt.
    const args = [
      ...(req.resume ? ['--continue'] : []),
      ...(this.opts.model ? ['--model', this.opts.model] : []),
      '--prompt', req.resume ? req.message : `${req.systemPrompt}\n\n${req.message}`,
    ]
    return new Promise((resolve) => {
      // Runtime commands are owner-configured shell commands, as for workers.
      const child = spawn('/bin/sh', ['-c', `exec ${command} "$@"`, 'kimi-captain', ...args], { cwd, env: { ...process.env, KIMI_CODE_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), this.opts.timeoutSec * 1000)
      const result = (text: string, isError: boolean): TurnResult => ({ text, isError, contextTokens: 0, contextWindow: null, costUsd: 0 })
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { err += d })
      child.on('error', (e) => { clearTimeout(timer); resolve(result(e.message, true)) })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        const failed = !!signal || code !== 0 || !out.trim()
        const text = signal ? `Kimi turn killed (${signal})` : failed ? (err || out || `Kimi exited ${code}`).trim().slice(-500) : out.trim()
        resolve({ ...result(text, failed), ...(failed && req.resume && /no (previous|such) session|session.*not found|unknown session/i.test(text) ? { sessionMissing: true } : {}) })
      })
    })
  }
}
