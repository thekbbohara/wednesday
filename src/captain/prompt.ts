// Builds what the captain sees each turn. A fresh session gets the whole
// working set (Now, open tasks, recent conversation, recall); a resumed one
// only gets what it has not seen yet.
import type { Config } from '../config.ts'
import type { Hit, LedgerEntry, LedgerKind, Memory } from '../memory/store.ts'

export const CONVERSATION_KINDS: readonly LedgerKind[] = ['owner', 'captain', 'decision', 'agent']
const RECALL_LEDGER_KINDS: readonly LedgerKind[] = ['owner', 'captain', 'decision', 'agent', 'task', 'fact', 'system']
const MAX_ENTRY_CHARS = 1500

/** What a live session has already been shown, so resumed turns stay lean. */
export interface SessionView {
  /** Has this session been given the full working set yet? */
  primed: boolean
  nowVersion: number
  seen: Set<string>
}

export function newView(): SessionView {
  return { primed: false, nowVersion: 0, seen: new Set() }
}

export interface BuiltPrompt {
  text: string
  /** Ids injected this turn, for tests and the ledger. */
  injected: string[]
}

export function buildTurnPrompt(mem: Memory, cfg: Config, owner: LedgerEntry, view: SessionView, sessionId: string): BuiltPrompt {
  const parts: string[] = []
  const injected: string[] = []
  const fresh = !view.primed
  view.primed = true

  const now = mem.nowGet()
  // A resumed session already knows Now if it wrote it itself.
  const nowFromElsewhere = now.version > view.nowVersion && lastNowAuthor(mem) !== sessionId
  if (fresh || nowFromElsewhere) {
    parts.push(now.version ? `<now version="${now.version}" updated="${now.updated_at}">\n${now.text}\n</now>` : '<now>(empty: nothing recorded yet)</now>')
  }
  view.nowVersion = now.version

  let tailStart = owner.id
  if (fresh) {
    const tasks = mem.taskList({ open: true, limit: 20 })
    parts.push(`<open_tasks>\n${tasks.length ? tasks.map((t) => `T${t.id} [${t.status}] ${t.title} - ${t.goal}`).join('\n') : '(none)'}\n</open_tasks>`)

    const tail = conversationTail(mem, owner.id, cfg.tailMessages, cfg.tailChars)
    if (tail.length) {
      tailStart = tail[0].id
      for (const e of tail) view.seen.add(`L${e.id}`)
      parts.push(`<recent_conversation note="before this session; the owner saw all of it">\n${tail.map(fmtEntry).join('\n')}\n</recent_conversation>`)
    }
  }

  const recalled: Hit[] = []
  for (const h of mem.searchFacts(owner.text, cfg.recallFacts)) recalled.push(h)
  for (const h of mem.searchLedger(owner.text, cfg.recallLedger, { beforeId: tailStart, kinds: RECALL_LEDGER_KINDS })) recalled.push(h)
  const fresher = recalled.filter((h) => !view.seen.has(h.ref))
  if (fresher.length) {
    for (const h of fresher) {
      view.seen.add(h.ref)
      injected.push(h.ref)
    }
    parts.push(
      `<recalled note="keyword matches for the message below; may be partial or irrelevant, use memory_search for more">\n${fresher
        .map((h) => `${h.ref} (${h.date.slice(0, 10)}) ${h.title}: ${clip(h.text, 600)}`)
        .join('\n')}\n</recalled>`,
    )
  }

  view.seen.add(`L${owner.id}`)
  const header = parts.length ? `<memory>\n${parts.join('\n\n')}\n</memory>\n\n` : ''
  return { text: `${header}<owner_message id="L${owner.id}" at="${owner.ts}">\n${owner.text}\n</owner_message>`, injected }
}

export function handoffPrompt(reason: string): string {
  return (
    `<system_notice>Session rotation (${reason}). This session ends after this turn and a fresh one continues from memory alone. ` +
    'Call now_update so Now holds: current goals and why, open tasks by T id with their next step, anything waiting on the owner, ' +
    'and decisions a successor must not re-litigate (cite L/F ids). Save any durable fact not yet written with memory_write. ' +
    'Then reply with one line: "handoff saved".</system_notice>'
  )
}

/** Most recent conversation before `beforeId`, oldest first, within a char budget. */
export function conversationTail(mem: Memory, beforeId: number, limit: number, budget: number): LedgerEntry[] {
  const rows = mem.ledgerTail(limit + 1, CONVERSATION_KINDS).filter((e) => e.id < beforeId)
  const out: LedgerEntry[] = []
  let used = 0
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const size = Math.min(rows[i].text.length, MAX_ENTRY_CHARS) + 40
    if (used + size > budget) break
    used += size
    out.unshift(rows[i])
  }
  return out
}

function lastNowAuthor(mem: Memory): string | null {
  const [last] = mem.ledgerTail(1, ['now'])
  return last?.session ?? null
}

function fmtEntry(e: LedgerEntry): string {
  return `[L${e.id} ${e.ts.slice(0, 16).replace('T', ' ')} ${e.kind}] ${clip(e.text, MAX_ENTRY_CHARS)}`
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)} ...[truncated, memory_get for full]` : s
}
