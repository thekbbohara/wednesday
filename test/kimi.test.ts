import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KimiRunner } from '../src/captain/kimi.ts'

describe('Kimi captain runner', () => {
  it('uses the configured worker CLI, isolated MCP tools, prompt and continuation', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kimi-runner-'))
    const source = join(dataDir, 'auth')
    mkdirSync(source)
    writeFileSync(join(source, 'config.toml'), 'default_model = "kimi"')
    const script = join(dataDir, 'fake.mjs')
    writeFileSync(script, `import { readFileSync } from 'node:fs'; import { join } from 'node:path'; console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), home: process.env.KIMI_CODE_HOME, mcp: JSON.parse(readFileSync(join(process.env.KIMI_CODE_HOME, 'mcp.json'), 'utf8')) }));`)
    writeFileSync(join(dataDir, 'runtimes.json'), JSON.stringify([{ id: 'kimi', command: `${process.execPath} ${script}` }]))
    const previous = process.env.KIMI_CODE_HOME
    process.env.KIMI_CODE_HOME = source
    try {
      const runner = new KimiRunner({ dataDir, model: 'kimi', timeoutSec: 5 })
      const req = { sessionId: 'session-one', resume: false, message: 'owner message', systemPrompt: 'captain instructions', mcpServers: { majordomo: { command: 'node', args: ['mcp.ts'], env: { MAJORDOMO_DB: '/tmp/test.db' } } } }
      const first = await runner.run(req)
      expect(first.isError).toBe(false)
      const output = JSON.parse(first.text)
      expect(output.args).toEqual(['--model', 'kimi', '--prompt', 'captain instructions\n\nowner message'])
      expect(output.home).toBe(join(dataDir, 'kimi-captain'))
      expect(output.cwd).toBe(join(dataDir, 'kimi-captain', 'sessions-work', req.sessionId))
      expect(output.mcp.mcpServers).toEqual(req.mcpServers)
      const second = await runner.run({ ...req, resume: true })
      expect(JSON.parse(second.text).args).toEqual(['--continue', '--model', 'kimi', '--prompt', 'owner message'])
      writeFileSync(join(dataDir, 'runtimes.json'), JSON.stringify([{ id: 'kimi', command: 'exit 1' }]))
      expect((await runner.run(req)).isError).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.KIMI_CODE_HOME
      else process.env.KIMI_CODE_HOME = previous
    }
  })
})
