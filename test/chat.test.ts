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

describe('page rows', () => {
  it('shows a page change as one receipt line, from the captain or the background pass, and opens that version', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { Memory } = await import('../src/memory/store.ts')
    const { Pages } = await import('../src/memory/pages.ts')
    const { sidecars } = await import('../src/config.ts')
    const { chatPage, describeRef, toChatItem } = await import('../src/web/chat.ts')
    const mem = new Memory(join(mkdtempSync(join(tmpdir(), 'wed-chatpage-')), 'memory.db'))
    const pages = new Pages(sidecars(mem.path).pages)
    const f = mem.factWrite({ kind: 'project', subject: 'clipcrew', body: 'studio app', source: 'owner' })
    pages.update(mem, 'clipcrew', { title: 'ClipCrew', keywords: ['clipcrew'], body: `Studio app [F${f.id}].` }, 'sess')
    pages.update(mem, 'clipcrew', { body: `Studio app moved [F${f.id}].`, note: 'moved' }, 'sleep')
    const [v1, v2] = mem.ledgerTail(2, ['page'])
    expect(toChatItem(v1)).toEqual({ id: v1.id, ts: v1.ts, type: 'receipt', verb: 'started page', ref: `L${v1.id}`, label: 'clipcrew' })
    expect(toChatItem(v2)).toMatchObject({ type: 'receipt', verb: 'updated page', label: 'clipcrew' })
    expect(chatPage(mem, null, 10).items.filter((i) => i.type === 'receipt' && i.label === 'clipcrew')).toHaveLength(2)
    const ref = describeRef(mem, `L${v1.id}`)!
    expect(ref.title).toBe('Page clipcrew, version 1')
    expect(ref.body).toBe(`created\n\nStudio app [F${f.id}].`)
    expect(describeRef(mem, `L${v2.id}`)!.body).toMatch(/^moved\n\nStudio app moved/)
  })
})
