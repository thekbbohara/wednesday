// Turns ledger entries into what the chat shows. The chat is the ledger:
// conversation, receipts of what the captain wrote to memory, and failures.
// Session starts and rotations stay invisible.
import type { LedgerEntry, Memory } from '../memory/store.ts'
import { SLEEP_SESSION, summaryLine } from '../sleep/sleep.ts'

export type ChatItem =
  | { type: 'owner' | 'captain'; id: number; ts: string; text: string }
  | { type: 'receipt'; id: number; ts: string; verb: string; ref: string }
  | { type: 'error'; id: number; ts: string; text: string }
  | { type: 'agent'; id: number; ts: string; agent: string; event: string; text: string }
  | { type: 'digest'; id: number; ts: string; text: string }
  | { type: 'levelup'; id: number; ts: string; skill: string; level: number }

const SHOWN = ['owner', 'captain', 'fact', 'task', 'decision', 'now', 'system', 'agent', 'digest'] as const
/** Agent events the owner sees; the captain's own messages and answers to agents stay in the ledger. */
const SHOWN_AGENT_EVENTS = new Set(['spawn', 'report', 'needs', 'exit', 'error', 'stop'])

export function toChatItem(e: LedgerEntry): ChatItem | null {
  const base = { id: e.id, ts: e.ts }
  // The nightly sleep shows as one overnight row (its digest), not a stream of receipts.
  if (e.session === SLEEP_SESSION && e.kind !== 'digest') return null
  switch (e.kind) {
    case 'digest': {
      const m = e.meta ?? {}
      const counts = { added: Number(m.added ?? 0), superseded: Number(m.superseded ?? 0), staled: Number(m.staled ?? 0), merged: Number(m.merged ?? 0) }
      return { ...base, type: 'digest', text: `Overnight I tidied memory: ${summaryLine(counts)}` }
    }
    case 'owner':
      return { ...base, type: e.kind, text: e.text }
    case 'captain':
      return e.meta?.silent ? null : { ...base, type: e.kind, text: e.text }
    case 'agent': {
      const event = String(e.meta?.event ?? '')
      if (!SHOWN_AGENT_EVENTS.has(event)) return null
      const agent = String(e.meta?.agent ?? '')
      return { ...base, type: 'agent', agent, event, text: agentLine(event, agent, e) }
    }
    case 'fact': {
      const id = e.meta?.fact
      if (typeof id !== 'number') return null
      const verb = / marked stale: /.test(e.text) ? 'marked stale' : / merged into /.test(e.text) ? 'merged' : 'saved'
      return { ...base, type: 'receipt', verb, ref: `F${id}` }
    }
    case 'task': {
      const id = e.meta?.task
      if (typeof id !== 'number') return null
      const to = e.meta?.status
      // Creation entries carry no `from` status; updates do.
      const from = e.meta?.from
      const verb = from === undefined ? 'created' : to !== from && to === 'done' ? 'finished' : to !== from && to === 'cancelled' ? 'cancelled' : 'updated'
      return { ...base, type: 'receipt', verb, ref: `T${id}` }
    }
    case 'decision':
      return { ...base, type: 'receipt', verb: 'decided', ref: `L${e.id}` }
    case 'now':
      return { ...base, type: 'receipt', verb: 'updated', ref: 'now' }
    case 'system': {
      const up = e.meta?.levelup as { skill: string; level: number } | undefined
      if (up) return { ...base, type: 'levelup', skill: up.skill, level: up.level }
      return e.meta?.error ? { ...base, type: 'error', text: e.text.replace(/^Captain turn failed: /, '') } : null
    }
    default:
      return null
  }
}

/** The one-line summary the chat shows; the full text is behind the ledger chip. */
function agentLine(event: string, agent: string, e: LedgerEntry): string {
  const first = e.text.split('\n')[0].replace(new RegExp(`^${agent} `), '')
  switch (event) {
    case 'report':
      return 'finished a turn'
    case 'needs':
      return `needs an answer: ${String(e.meta?.reason ?? 'prompt')}`
    case 'spawn':
      // The full path is in the ledger entry; the chat line names the folder only.
      return first.replace(/ in (\/\S+)$/, (_, p: string) => ` in ${p.split('/').filter(Boolean).pop()}`)
    default:
      return first
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
      if (kind === 'agent') {
        const meta = (r.meta ?? {}) as Record<string, unknown>
        const body = String(r.text).replace(/^\S+ reported:\n/, '')
        return { ref: got.ref, title: `${meta.agent ?? 'Agent'}, ${String(meta.event ?? 'event')}`, body, date: String(r.ts) }
      }
      if (kind === 'digest') {
        const meta = (r.meta ?? {}) as Record<string, unknown>
        return { ref: got.ref, title: `Digest of ${meta.date ?? 'the day'}`, body: String(r.text).replace(/^Digest \S+: /, ''), date: String(r.ts) }
      }
      const who = kind === 'owner' ? 'You said' : kind === 'captain' ? 'Jarvis said' : kind[0].toUpperCase() + kind.slice(1)
      return { ref: got.ref, title: who, body: String(r.text), date: String(r.ts) }
    }
  }
}
