// The supervisor against real tmux on a throwaway socket, with scripted agents.
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory, type LedgerEntry } from '../src/memory/store.ts'
import { composeBrief, Supervisor } from '../src/agents/supervisor.ts'

const FIX = join(import.meta.dirname, '../src/agents/fixtures')
const socket = `jarvis-test-${process.pid}`

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-sup-'))
  writeFileSync(
    join(dataDir, 'runtimes.json'),
    JSON.stringify([
      { id: 'fake', command: `bash ${join(FIX, 'fake-agent.sh')}` },
      { id: 'menu', command: `bash ${join(FIX, 'menu.sh')}` },
    ]),
  )
  const mem = new Memory(join(dataDir, 'memory.db'))
  const sup = new Supervisor({ mem, dataDir, socket, hook: null, pollMs: 150, timings: { briefSettleMs: 400, needsStableMs: 300, idleTurnMs: 500 } })
  const events: { entry: LedgerEntry; wake: boolean }[] = []
  sup.on('event', (entry: LedgerEntry, wake: boolean) => events.push({ entry, wake }))
  sup.start()
  return { mem, sup, events, dataDir }
}

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-repo-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), 'hi\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  return dir
}

async function until<T>(get: () => T | undefined | null | false, ms = 15_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = get()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const sups: Supervisor[] = []
afterAll(() => {
  for (const s of sups) s.stop()
  try {
    execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' })
  } catch {}
})

describe('supervisor', () => {
  it('delivers the brief, then reports the end of a turn from the screen (no hook)', { timeout: 30_000 }, async () => {
    const { sup, events, dataDir } = setup()
    sups.push(sup)
    const a = await sup.spawn({ id: 'echo', runtime: 'fake', cwd: dataDir, brief: 'count the files' })
    expect(a).toMatchObject({ status: 'running', mood: 'working', branch: null })
    expect(events[0]).toMatchObject({ wake: false, entry: { kind: 'agent', meta: { agent: 'echo', event: 'spawn' } } })
    const report = await until(() => events.find((e) => e.entry.meta?.event === 'report'))
    expect(report.wake).toBe(true)
    // The fake reads the multi-line brief line by line; the turn ends after the last one.
    expect(report.entry.text).toMatch(/^echo finished a turn[\s\S]*done: When you finish, or need a decision/)

    await sup.send('echo', 'second job')
    const second = await until(() => events.filter((e) => e.entry.meta?.event === 'report')[1])
    expect(second.entry.text).toContain('done: second job')
    expect(sup.summary()).toMatch(/^echo \[idle\] fake - /)
  })

  it('escalates a prompt once, with its options, and answers it by label', { timeout: 30_000 }, async () => {
    const { sup, events, dataDir } = setup()
    sups.push(sup)
    await sup.spawn({ id: 'asker', runtime: 'menu', cwd: dataDir, brief: 'x' })
    const needs = await until(() => events.find((e) => e.entry.meta?.event === 'needs'))
    expect(needs.wake).toBe(true)
    expect(needs.entry.meta).toMatchObject({ reason: 'trust prompt', choices: ['No, exit', 'Yes, I trust this folder'] })
    expect(sup.get('asker')).toMatchObject({ mood: 'needs', reason: 'trust prompt' })
    // Not escalated again while the same prompt stays up.
    await new Promise((r) => setTimeout(r, 800))
    expect(events.filter((e) => e.entry.meta?.event === 'needs')).toHaveLength(1)

    await expect(sup.answer('asker', 'Maybe')).rejects.toThrow(/not an option/)
    await sup.answer('asker', 'Yes, I trust this folder')
    expect(await until(async () => (await sup.screen('asker')).includes('picked: Yes') || null)).toBeTruthy()
  })

  it('accepts the trust prompt itself for a worktree it made, on a fresh branch', { timeout: 30_000 }, async () => {
    const { sup, events, dataDir, mem } = setup()
    sups.push(sup)
    const repo = gitRepo()
    const t = mem.taskCreate({ title: 'Fix readme', goal: 'g' })
    const a = await sup.spawn({ id: 'fixer', runtime: 'menu', repo, brief: 'fix it', task_id: t.id })
    expect(a).toMatchObject({ repo, branch: 'jarvis/fixer', cwd: join(dataDir, 'worktrees', 'fixer'), task_id: t.id })
    expect(existsSync(join(a.cwd, 'README.md'))).toBe(true)
    const auto = await until(() => events.find((e) => e.entry.meta?.event === 'auto'))
    expect(auto).toMatchObject({ wake: false })
    expect(auto.entry.text).toBe("Jarvis accepted fixer's prompt: Yes, I trust this folder")
    expect(events.some((e) => e.entry.meta?.event === 'needs')).toBe(false)

    // Removing keeps the branch, and refuses while there are uncommitted changes.
    writeFileSync(join(a.cwd, 'new.txt'), 'x')
    await expect(sup.stopAgent('fixer', true)).rejects.toThrow(/uncommitted changes[\s\S]*new.txt/)
    expect(existsSync(a.cwd)).toBe(true)
    execFileSync('rm', [join(a.cwd, 'new.txt')])
    await sup.stopAgent('fixer', true)
    expect(existsSync(a.cwd)).toBe(false)
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'jarvis/fixer']).toString()).toContain('jarvis/fixer')
    expect(mem.agentGet('fixer')?.status).toBe('removed')
    expect(sup.list().map((x) => x.id)).not.toContain('fixer')
  })

  it('reports an agent that dies, once, and marks it stopped', { timeout: 30_000 }, async () => {
    const { sup, events, dataDir, mem } = setup()
    sups.push(sup)
    await sup.spawn({ id: 'quitter', runtime: 'menu', cwd: dataDir, brief: 'x' })
    await until(() => events.find((e) => e.entry.meta?.event === 'needs'))
    await sup.answer('quitter', 'No, exit')
    const died = await until(() => events.find((e) => e.entry.meta?.event === 'error'))
    expect(died).toMatchObject({ wake: true, entry: { text: 'quitter exited with code 1' } })
    expect(mem.agentGet('quitter')?.status).toBe('stopped')
    expect(sup.get('quitter').mood).toBe('offline')
    await new Promise((r) => setTimeout(r, 500))
    expect(events.filter((e) => e.entry.meta?.event === 'error')).toHaveLength(1)
  })

  it('records hook reports and wakes the captain with them', () => {
    const { sup, events, dataDir, mem } = setup()
    sups.push(sup)
    mem.agentCreate({ id: 'w', task_id: null, runtime: 'claude-code', cwd: dataDir, repo: null, branch: null, brief: 'b' })
    expect(sup.report('w', '  All tests pass.  ')?.text).toBe('w reported:\nAll tests pass.')
    expect(events.at(-1)?.wake).toBe(true)
    expect(sup.report('nobody', 'x')).toBeNull()
    expect(sup.report('w', '   ')).toBeNull()
  })

  it('validates spawn requests', async () => {
    const { sup, dataDir } = setup()
    sups.push(sup)
    await expect(sup.spawn({ id: 'Bad Name', runtime: 'fake', cwd: dataDir, brief: 'x' })).rejects.toThrow(/lowercase/)
    await expect(sup.spawn({ id: 'a', runtime: 'nope', cwd: dataDir, brief: 'x' })).rejects.toThrow(/Unknown runtime "nope". Known: claude-code/)
    await expect(sup.spawn({ id: 'a', runtime: 'fake', brief: 'x' })).rejects.toThrow(/exactly one of repo/)
    await expect(sup.spawn({ id: 'a', runtime: 'fake', cwd: dataDir, repo: dataDir, brief: 'x' })).rejects.toThrow(/exactly one of repo/)
    await expect(sup.spawn({ id: 'a', runtime: 'fake', repo: dataDir, brief: 'x' })).rejects.toThrow(/Not a git repo/)
    await expect(sup.spawn({ id: 'a', runtime: 'fake', cwd: dataDir, brief: ' ' })).rejects.toThrow(/brief is required/)
    await expect(sup.spawn({ id: 'a', runtime: 'fake', cwd: dataDir, brief: 'x', task_id: 9 })).rejects.toThrow(/No task T9/)
    await sup.spawn({ id: 'a', runtime: 'fake', cwd: dataDir, brief: 'x' })
    await expect(sup.spawn({ id: 'a', runtime: 'fake', cwd: dataDir, brief: 'x' })).rejects.toThrow(/already exists/)
  })
})

describe('composeBrief', () => {
  it('tells a worktree agent its branch and how to report', () => {
    const b = composeBrief({ id: 'fixer', task_id: 3, cwd: '/w', branch: 'jarvis/fixer', brief: 'Fix the bug.' }, 'Bug')
    expect(b).toContain('gave you this job (task T3: Bug):')
    expect(b).toContain('on branch jarvis/fixer')
    expect(b).toContain('end your turn with a short report')
  })
})
