// Agent runtimes, as in agent-hq (server/engine/config.ts), minus human seats.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Runtime {
  id: string
  label: string
  /** Shell command that starts the agent inside its working directory. */
  command: string
  /** Keys that interrupt the agent's current turn. */
  interrupt: string[]
  /** Which built-in turn hook reports this runtime's replies, if any. Without one, a turn ends when the screen goes idle. */
  turnHook?: 'claude' | 'codex'
}

// Workers run unattended, so Claude Code uses auto mode: routine actions are
// approved by its classifier and risky ones still stop at a prompt.
const DEFAULT_RUNTIMES: Runtime[] = [
  { id: 'claude-code', label: 'Claude Code', command: 'claude --permission-mode auto', interrupt: ['Escape'], turnHook: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex', interrupt: ['Escape'], turnHook: 'codex' },
  { id: 'pi', label: 'pi', command: 'pi', interrupt: ['Escape'] },
  { id: 'kimi', label: 'Kimi', command: 'kimi', interrupt: ['Escape'] },
  { id: 'opencode', label: 'opencode', command: 'opencode', interrupt: ['Escape'] },
  { id: 'agy', label: 'agy (Gemini)', command: 'agy', interrupt: ['Escape'] },
]

/**
 * Defaults above, overridden or extended by `<data>/runtimes.json`:
 * `[{ "id": "claude-code", "command": "claude --model sonnet --permission-mode auto" }]`.
 */
export function loadRuntimes(dataDir: string): Runtime[] {
  const file = join(dataDir, 'runtimes.json')
  if (!existsSync(file)) return DEFAULT_RUNTIMES
  const overrides = JSON.parse(readFileSync(file, 'utf8')) as Array<Partial<Runtime> & { id: string }>
  const merged = new Map(DEFAULT_RUNTIMES.map((r) => [r.id, r]))
  for (const o of overrides) {
    const base = merged.get(o.id)
    merged.set(o.id, { label: o.id, command: o.id, interrupt: ['Escape'], ...base, ...o })
  }
  return [...merged.values()]
}
