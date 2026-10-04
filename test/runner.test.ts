// ClaudeRunner against a stand-in `claude` that echoes the arguments it got.
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeRunner, parseResult } from '../src/captain/runner.ts'

const dir = mkdtempSync(join(tmpdir(), 'majordomo-runner-'))
const bin = join(dir, 'claude')
writeFileSync(
  bin,
  `#!/usr/bin/env node
process.stdin.resume(); process.stdin.on('end', () => {
  const a = process.argv.slice(2)
  const at = (f) => a[a.indexOf(f) + 1]
  console.log(JSON.stringify({ result: JSON.stringify({ model: at('--model'), tools: at('--tools'), allowed: at('--allowedTools') }),
    usage: { iterations: [{ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 5 }] },
    modelUsage: { m: { contextWindow: 200000 } }, total_cost_usd: 0.01 }))
})
`,
)
chmodSync(bin, 0o755)

describe('ClaudeRunner', () => {
  it('reads model and tools at call time, so settings apply to the next turn', async () => {
    const live = { model: 'haiku', tools: ['Read'] }
    const r = new ClaudeRunner({ bin, model: () => live.model, allowedTools: () => live.tools, cwd: dir, timeoutSec: 10 })
    const req = { sessionId: 's', resume: false, message: 'hi', systemPrompt: 'p', mcpServers: { majordomo: { command: 'x', args: [], env: {} } } }
    const first = await r.run(req)
    expect(JSON.parse(first.text)).toEqual({ model: 'haiku', tools: 'Read', allowed: 'mcp__majordomo,Read' })
    expect(first).toMatchObject({ contextTokens: 115, contextWindow: 200000, isError: false })
    live.model = 'opus'
    live.tools = ['Read', 'WebSearch', 'WebFetch']
    expect(JSON.parse((await r.run(req)).text)).toEqual({ model: 'opus', tools: 'Read,WebSearch,WebFetch', allowed: 'mcp__majordomo,Read,WebSearch,WebFetch' })
  })

  it('rejects output that is not claude JSON', () => {
    expect(parseResult('not json')).toBeNull()
  })
})
