// Turns ledger entries into what the chat shows. The chat is the ledger:
// conversation, receipts of what the captain wrote to memory, and failures.
// Session starts and rotations stay invisible.
import type { LedgerEntry, Memory } from '../memory/store.ts'

export type ChatItem =
  | { type: 'owner' | 'captain'; id: number; ts: string; text: string }
  | { type: 'receipt'; id: number; ts: string; verb: string; ref: string }
  | { type: 'error'; id: number; ts: string; text: string }

const SHOWN = ['owner', 'captain', 'fact', 'task', 'decision', 'now', 'system'] as const

export function toChatItem(e: LedgerEntry): ChatItem | null {
  const base = { id: e.id, ts: e.ts }
  switch (e.kind) {
    case 'owner':
    case 'captain':
      return { ...base, type: e.kind, text: e.text }
    case 'fact': {
      const id = e.meta?.fact
      if (typeof id !== 'number') return null
      return { ...base, type: 'receipt', verb: / marked stale: /.test(e.text) ? 'marked stale' : 'saved', ref: `F${id}` }
    }
    case 'task': {
      const id = e.meta?.task
      if (typeof id !== 'number') return null
      const to = e.meta?.status
      const verb = / created /.test(e.text) ? 'created' : to !== e.meta?.from && (to === 'done' || to === 'cancelled') ? `${to === 'done' ? 'finished' : 'cancelled'}` : 'updated'
      return { ...base, type: 'receipt', verb, ref: `T${id}` }
    }
    case 'decision':
      return { ...base, type: 'receipt', verb: 'decided', ref: `L${e.id}` }
    case 'now':
      return { ...base, type: 'receipt', verb: 'updated', ref: 'now' }
    case 'system':
      return e.meta?.error ? { ...base, type: 'error', text: e.text.replace(/^Captain turn failed: /, '') } : null
    default:
      return null
  }
}

/** A page of chat: the last `limit` messages before `before`, plus everything shown between them. */
export function chatPage(mem: Memory, before: number | null, limit: number): { items: ChatItem[]; hasMore: boolean } {
  const upper = before ?? Number.MAX_SAFE_INTEGER
  const marks = mem.db
    .prepare("SELECT id FROM ledger WHERE kind IN ('owner', 'captain') AND id < ? ORDER BY id DESC LIMIT ?")
    .all(upper, limit + 1) as { id: number }[]
  const hasMore = marks.length > limit
  const from = hasMore ? marks[limit - 1].id : 0
  const rows = mem.db
    .prepare(`SELECT * FROM ledger WHERE id >= ? AND id < ? AND kind IN (${SHOWN.map(() => '?').join(',')}) ORDER BY id`)
    .all(from, upper, ...SHOWN) as Record<string, unknown>[]
  const items = rows
    .map((r) => toChatItem({ ...r, meta: r.meta ? JSON.parse(String(r.meta)) : null } as LedgerEntry))
    .filter((i): i is ChatItem => i !== null)
  return { items, hasMore }
}

/** What a citation chip shows. */
export function describeRef(mem: Memory, ref: string): { ref: string; title: string; body: string; date: string; source?: string; stale?: boolean } | null {
  if (ref.toLowerCase() === 'now') {
    const n = mem.nowGet()
    return { ref: 'Now', title: `Now, version ${n.version}`, body: n.text || '(empty)', date: n.updated_at }
  }
  const got = mem.get(ref)
  if (!got) return null
  const r = got.record as Record<string, unknown>
  switch (got.kind) {
    case 'fact':
      return {
        ref: got.ref,
        title: String(r.subject),
        body: String(r.body),
        date: String(r.updated_at),
        source: String(r.source),
        stale: Boolean(r.stale),
      }
    case 'task':
      return {
        ref: got.ref,
        title: `${r.title} (${String(r.status).replace('_', ' ')})`,
        body: [`Goal: ${r.goal}`, r.plan ? `Plan: ${r.plan}` : '', r.result ? `Result: ${r.result}` : ''].filter(Boolean).join('\n\n'),
        date: String(r.updated_at),
      }
    default: {
      const kind = String(r.kind)
      if (kind === 'decision') {
        const m = /^Decision: ([\s\S]*?)\. Reason: ([\s\S]*)$/.exec(String(r.text))
        if (m) return { ref: got.ref, title: 'Decision', body: `${m[1]}.\n\nWhy: ${m[2]}`, date: String(r.ts) }
      }
      const who = kind === 'owner' ? 'You said' : kind === 'captain' ? 'Jarvis said' : kind[0].toUpperCase() + kind.slice(1)
      return { ref: got.ref, title: who, body: String(r.text), date: String(r.ts) }
    }
  }
}
