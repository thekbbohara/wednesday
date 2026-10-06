// The claudeConfigDir setting: which Claude account (CLAUDE_CONFIG_DIR) the
// captain, the nightly sleep and claude-code workers launch with.
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { apply, check, currentSettings, loadSettings, saveSettings } from '../src/settings.ts'
import { claudeAccount, claudeEnv, configDirError, contractHome, expandHome } from '../src/claude-account.ts'
import { parseChain, primaryChain, selectedChain } from '../src/captain/provider.ts'
import { buildRunner } from '../src/captain/chain.ts'
import { Captain } from '../src/captain/captain.ts'
import { Memory } from '../src/memory/store.ts'
import { ClaudeSleepModel } from '../src/sleep/sleep.ts'
import { launchSpec } from '../src/agents/supervisor.ts'
import { loadRuntimes } from '../src/agents/runtimes.ts'
import { createApp } from '../src/server.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `majordomo-ccw-${p}-`))
const req: TurnRequest = { sessionId: 's', resume: false, message: 'hi', systemPrompt: 'p', mcpServers: {} }

// Stand-in `claude` that reports the CLAUDE_CONFIG_DIR it was started with, as a captain turn or a sleep.
const binDir = tmp('bin')
const bin = join(binDir, 'claude')
writeFileSync(
  bin,
  `#!/usr/bin/env node
process.stdin.resume(); process.stdin.on('end', () => {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? null
  console.log(JSON.stringify({ result: JSON.stringify({ dir }), usage: {}, structured_output: { add: [], supersede: [], stale: [], merge: [], digest: 'dir=' + dir } }))
})
`,
)
chmodSync(bin, 0o755)

const saved = process.env.CLAUDE_CONFIG_DIR
afterEach(() => {
  if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = saved
})

describe('config and settings', () => {
  it('defaults from CLAUDE_CONFIG_DIR, "~" expanded; unset means the default login', () => {
    process.env.CLAUDE_CONFIG_DIR = '~/.claude-work'
    expect(loadConfig({ dataDir: tmp('cfg') }).claudeConfigDir).toBe(join(homedir(), '.claude-work'))
    delete process.env.CLAUDE_CONFIG_DIR
    const cfg = loadConfig({ dataDir: tmp('cfg') })
    expect(cfg.claudeConfigDir).toBe('')
    // The primary stays the plain default login; the account is applied per turn.
    expect(cfg.captainChain[0]).toEqual({ id: 'claude', kind: 'claude', label: 'Claude' })
  })

  it('accepts an existing folder (absolute or ~/) or empty, and rejects the rest', () => {
    const dir = tmp('acct')
    expect(check({ claudeConfigDir: dir })).toEqual({})
    expect(check({ claudeConfigDir: '' })).toEqual({})
    expect(check({ claudeConfigDir: '~' })).toEqual({})
    expect(check({ claudeConfigDir: join(dir, 'missing') }).claudeConfigDir).toMatch(/does not exist/)
    expect(check({ claudeConfigDir: 'relative/dir' }).claudeConfigDir).toMatch(/absolute path/)
    expect(check({ claudeConfigDir: 42 as unknown as string }).claudeConfigDir).toMatch(/folder path/)
    writeFileSync(join(dir, 'file'), '')
    expect(configDirError(join(dir, 'file'))).toMatch(/not a folder/)
  })

  it('is saved to settings.json with ~ and loaded back expanded; a missing folder is ignored with a warning', () => {
    const dataDir = tmp('set')
    const cfg = loadConfig({ dataDir, claudeConfigDir: '' })
    apply(cfg, { claudeConfigDir: '~' })
    expect(cfg.claudeConfigDir).toBe(homedir())
    saveSettings(cfg)
    expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).claudeConfigDir).toBe('~')
    const next = loadConfig({ dataDir, claudeConfigDir: '' })
    loadSettings(next)
    expect(next.claudeConfigDir).toBe(homedir())
    expect(currentSettings(next).claudeConfigDir).toBe('~')

    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ claudeConfigDir: '/no/such/claude-dir' }))
    const warnings: string[] = []
    const third = loadConfig({ dataDir, claudeConfigDir: '' })
    loadSettings(third, (m) => warnings.push(m))
    expect(third.claudeConfigDir).toBe('')
    expect(warnings).toEqual(['settings.json: ignoring claudeConfigDir'])
  })

  it('expands and contracts ~, and builds the launch env (an inherited value is dropped for the default)', () => {
    expect(expandHome('~/.claude-work')).toBe(join(homedir(), '.claude-work'))
    expect(expandHome('  ')).toBe('')
    expect(contractHome(join(homedir(), '.claude-work'))).toBe('~/.claude-work')
    expect(contractHome('/opt/x')).toBe('/opt/x')
    expect(claudeEnv('/a', { PATH: '/bin' })).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/a' })
    expect(claudeEnv('', { PATH: '/bin', CLAUDE_CONFIG_DIR: '/old' })).toEqual({ PATH: '/bin' })
  })

  it('tells login state from the credentials file and the account email from .claude.json', () => {
    const dir = tmp('acct')
    expect(claudeAccount(dir)).toMatchObject({ exists: true, loggedIn: false, email: null })
    writeFileSync(join(dir, '.credentials.json'), '{}')
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' } }))
    expect(claudeAccount(dir)).toMatchObject({ exists: true, loggedIn: true, email: 'me@example.com' })
    expect(claudeAccount(join(dir, 'nope'))).toMatchObject({ exists: false, loggedIn: false })
  })
})

describe('captain', () => {
  it('puts the primary on the set account, keeps fallbacks, and keeps the account in a model override id', () => {
    const work = join(homedir(), '.claude-work')
    const chain = primaryChain(parseChain('claude:~/.claude-work, claude:~/.claude, codex'), work)
    expect(chain.map((p) => p.id)).toEqual(['claude@.claude-work', 'claude@.claude', 'codex'])
    expect(chain[0]).toMatchObject({ kind: 'claude', configDir: work, label: 'Claude (claude-work)' })
    expect(primaryChain(chain, '')[0].id).toBe('claude')
    expect(selectedChain(chain, 'claude', 'sonnet')[0]).toMatchObject({ id: 'claude@.claude-work:sonnet', configDir: work, model: 'sonnet' })
    expect(selectedChain(primaryChain(chain, ''), 'claude', 'sonnet')[0].id).toBe('claude:sonnet')
  })

  it('launches claude with CLAUDE_CONFIG_DIR for the set account, and without it for the default', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/inherited'
    const acct = tmp('acct')
    const cfg = loadConfig({ dataDir: tmp('cap'), claudeBin: bin, claudeConfigDir: acct })
    const [primary] = primaryChain(cfg.captainChain, cfg.claudeConfigDir)
    expect(JSON.parse((await buildRunner(primary, cfg).run(req)).text)).toEqual({ dir: acct })
    const [plain] = primaryChain(cfg.captainChain, '')
    expect(JSON.parse((await buildRunner(plain, cfg).run(req)).text)).toEqual({ dir: null })
  })

  it('switches to the new account at the next turn, on a fresh session, without a restart', async () => {
    const dataDir = tmp('cap')
    const cfg = loadConfig({ dataDir, claudeConfigDir: '' })
    const mem = new Memory(cfg.dbPath)
    const seen: { provider: string; dir: string | undefined; resume: boolean }[] = []
    const captain = new Captain(mem, cfg, (p): Runner => ({
      run: async (r: TurnRequest): Promise<TurnResult> => {
        seen.push({ provider: p.id, dir: p.configDir, resume: r.resume })
        return { text: 'ok', contextTokens: 10, contextWindow: 200000, costUsd: 0, isError: false }
      },
    }))
    await captain.handle('one')
    await captain.handle('two')
    const acct = join(tmp('acct'), '.claude-work')
    mkdirSync(acct)
    apply(cfg, { claudeConfigDir: acct })
    await captain.handle('three')
    expect(seen).toEqual([
      { provider: 'claude', dir: undefined, resume: false },
      { provider: 'claude', dir: undefined, resume: true },
      { provider: 'claude@.claude-work', dir: acct, resume: false },
    ])
    expect(mem.ledgerTail(10, ['rotation']).some((e) => /switched to Claude \(claude-work\)/.test(e.text))).toBe(true)
    // Replies from the set account are not tagged as a fallback.
    expect(mem.ledgerTail(1, ['captain'])[0].meta?.provider).toBeUndefined()
  })
})

describe('sleep', () => {
  it('launches the sleep model on the account read at sleep time', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/inherited'
    const prompt = join(tmp('p'), 'sleep.md')
    writeFileSync(prompt, 'sleep')
    const live = { dir: '/accounts/work' }
    const model = new ClaudeSleepModel({ bin, model: 'haiku', promptFile: prompt, timeoutSec: 10, cwd: binDir, configDir: () => live.dir })
    expect((await model.consolidate('day')).digest).toBe('dir=/accounts/work')
    live.dir = ''
    expect((await model.consolidate('day')).digest).toBe('dir=null')
  })
})

describe('workers', () => {
  const claudeCode = loadRuntimes(tmp('rt')).find((r) => r.id === 'claude-code')!

  it('start claude-code with CLAUDE_CONFIG_DIR in the terminal env', () => {
    const spec = launchSpec('w1', claudeCode, { hook: { url: 'http://127.0.0.1:1' }, hookScript: '/h.mjs', claudeConfigDir: '/home/me/.claude-work' })
    expect(spec.env).toMatchObject({ MAJORDOMO_AGENT: 'w1', CLAUDE_CONFIG_DIR: '/home/me/.claude-work' })
    expect(spec.command).toMatch(/^claude --permission-mode auto/)
  })

  it('unset an inherited CLAUDE_CONFIG_DIR when the default login is set', () => {
    const spec = launchSpec('w1', claudeCode, { hook: null, hookScript: '/h.mjs', claudeConfigDir: '' })
    expect(spec.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(spec.command).toMatch(/^unset CLAUDE_CONFIG_DIR; claude --permission-mode auto/)
  })
})

describe('api', () => {
  it('reads and changes the account from Settings, with validation and account info', async () => {
    const dataDir = tmp('srv')
    const cfg = loadConfig({ dataDir, claudeConfigDir: '' })
    const runner: Runner = { run: async () => ({ text: 'ok', contextTokens: 0, contextWindow: null, costUsd: 0, isError: false }) }
    const { app, close } = createApp({ mem: new Memory(cfg.dbPath), cfg, runner, pollMs: 50 })
    const put = (body: unknown) => app.request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const got = (await (await app.request('/api/settings')).json()) as { settings: { claudeConfigDir: string }; claudeAccount: { dir: string } }
    expect(got.settings.claudeConfigDir).toBe('')
    expect(got.claudeAccount.dir).toBe('~/.claude')

    const bad = await put({ claudeConfigDir: '/no/such/claude-dir' })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { errors: Record<string, string> }).errors.claudeConfigDir).toMatch(/does not exist/)

    const acct = tmp('acct')
    writeFileSync(join(acct, '.credentials.json'), '{}')
    const ok = (await (await put({ claudeConfigDir: acct })).json()) as { settings: { claudeConfigDir: string }; claudeAccount: { loggedIn: boolean } }
    expect(ok.settings.claudeConfigDir).toBe(contractHome(acct))
    expect(ok.claudeAccount.loggedIn).toBe(true)
    expect(cfg.claudeConfigDir).toBe(acct)
    close()
  })
})
