// Pure shared values: safe to use in the server, MCP and browser.
export const ENGINES = ['claude', 'codex', 'kimi', 'agy'] as const
export type Engine = typeof ENGINES[number]
// Advertised by CLI 1.3.1, but unavailable to this installation in two captain turns.
// Catalogue presence does not verify account access. Never select Opus implicitly.
export const AGY_CAPTAIN_MODEL = 'claude-opus-4-6-thinking'
export const AGY_WORKER_MODEL = 'gemini-3.8-flash-medium'
export const AGY_WORKER_COMMAND = `agy --model ${AGY_WORKER_MODEL}`
export const AGY_MODELS = [
  { id: AGY_CAPTAIN_MODEL, label: 'Claude Opus 4.6 (Thinking, access unverified)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: AGY_WORKER_MODEL, label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
]

export const defaultEngineModel = (engine: Engine): string => ''
