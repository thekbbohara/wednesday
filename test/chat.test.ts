import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '../src/memory/store.ts'
import { promptOf } from '../src/web/chat.ts'

describe('promptOf', () => {
  it('keeps what a Codex permission prompt asks, without its menu', () => {
    const choices = ['Yes, proceed (y)', 'No, and tell Codex what to do differently (esc)']
    const text = [
      'clipweb needs an answer (permission prompt). Its screen:',
      '',
      "  $ python - <<'PY'",
      "  p=Path('clipcrew/review.html')",
      '  PY',
      '  .venv/bin/python -m pytest -q',
      '',
      '',
      `› 1. ${choices[0]}`,
      `  2. ${choices[1]}`,
      '',
      '  Press enter to confirm or esc to cancel',
      '',
      `Options: ${choices.join(' | ')}`,
    ].join('\n')
    const e = { id: 1, ts: '', kind: 'agent', text, meta: { agent: 'clipweb', event: 'needs', choices } } as unknown as LedgerEntry
    expect(promptOf(e)).toBe("$ python - <<'PY'\np=Path('clipcrew/review.html')\nPY\n.venv/bin/python -m pytest -q")
  })

  it('keeps the whole screen tail for a prompt without a menu', () => {
    const e = { id: 1, ts: '', kind: 'agent', text: 'a needs an answer (yes/no prompt). Its screen:\n  Overwrite file? (y/n)', meta: { choices: null } } as unknown as LedgerEntry
    expect(promptOf(e)).toBe('Overwrite file? (y/n)')
  })
})
