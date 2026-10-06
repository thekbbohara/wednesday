import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadRuntimes } from '../src/agents/runtimes.ts'
import { Supervisor } from '../src/agents/supervisor.ts'
import type { Memory } from '../src/memory/store.ts'

describe('Codex worker permissions', () => {
  it('launches unattended with full access and preserves the turn hook', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-runtime-'))
    // Exercise the public spawn path without a database or a real tmux session.
    let row: object | null = null
    const mem = {
      agentGet: () => row,
      agentCreate: (input: object) => (row = { ...input, status: 'running' }),
      append: () => ({}),
    } as unknown as Memory
    const sup = new Supervisor({ mem, dataDir, socket: 'unused', hook: { url: 'http://localhost:4788' } })
    vi.spyOn(sup.tmux, 'kill').mockResolvedValue()
    const start = vi.spyOn(sup.tmux, 'start').mockResolvedValue()
    await sup.spawn({ id: 'testcodex', runtime: 'codex', cwd: dataDir, brief: 'test' })
    expect(start).toHaveBeenCalledWith(
      'majordomo_testcodex', dataDir,
      expect.stringMatching(/^(unset CLAUDE_CONFIG_DIR; )?codex --dangerously-bypass-approvals-and-sandbox -c .*notify=/),
      { MAJORDOMO_AGENT: 'testcodex', MAJORDOMO_URL: 'http://localhost:4788' },
    )
  })

  it('allows an explicit restricted command without adding bypass flags', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-runtime-'))
    const command = 'codex --sandbox workspace-write --ask-for-approval on-request'
    writeFileSync(join(dataDir, 'runtimes.json'), JSON.stringify([{ id: 'codex', command }]))
    expect(loadRuntimes(dataDir).find((r) => r.id === 'codex')).toMatchObject({ command, turnHook: 'codex' })
  })
})
