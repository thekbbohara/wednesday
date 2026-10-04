// Nightly "sleep": a cheap model reads the day's ledger and proposes how to
// update the facts; code validates every operation before applying it.
// Nothing is deleted: replaced or wrong facts are marked stale, and the day's
// digest is appended to the ledger, where it can be searched and cited.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { FACT_KINDS, type Fact, type FactKind, type LedgerEntry, type Memory } from '../memory/store.ts'

export const SLEEP_SESSION = 'sleep'
const CURSOR = 'sleep_cursor'
const ENTRY_CHARS = 2000
const ALL_FACTS_CHARS = 40_000

export interface NewFact {
  kind: FactKind
  subject: string
  body: string
  source: string
}

export interface SleepOps {
  add: NewFact[]
  supersede: (NewFact & { replaces: string[] })[]
  stale: { id: string; reason: string }[]
  merge: { keep: string; drop: string[] }[]
  digest: string
}

const fact = {
  kind: { type: 'string', enum: [...FACT_KINDS] },
  subject: { type: 'string' },
  body: { type: 'string' },
  source: { type: 'string', description: 'L id from this day, e.g. L42' },
}
export const OPS_SCHEMA = {
  type: 'object',
  properties: {
    add: { type: 'array', items: { type: 'object', properties: fact, required: ['kind', 'subject', 'body', 'source'] } },
    supersede: {
      type: 'array',
      items: { type: 'object', properties: { ...fact, replaces: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'subject', 'body', 'source', 'replaces'] },
    },
    stale: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    merge: {
      type: 'array',
      items: { type: 'object', properties: { keep: { type: 'string' }, drop: { type: 'array', items: { type: 'string' } } }, required: ['keep', 'drop'] },
    },
    digest: { type: 'string' },
  },
  required: ['add', 'supersede', 'stale', 'merge', 'digest'],
}

export interface SleepModel {
  consolidate(prompt: string): Promise<SleepOps>
}

/** Headless Claude Code with schema-checked output; no tools, no session kept. */
export class ClaudeSleepModel implements SleepModel {
  private opts: { bin: string; model: string | (() => string); promptFile: string; timeoutSec: number; cwd: string; name?: string }

  constructor(opts: { bin: string; model: string | (() => string); promptFile: string; timeoutSec: number; cwd: string; name?: string }) {
    this.opts = opts
  }

  consolidate(prompt: string): Promise<SleepOps> {
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', typeof this.opts.model === 'function' ? this.opts.model() : this.opts.model,
      '--setting-sources', '',
      '--strict-mcp-config',
      '--tools', '',
      '--no-session-persistence',
      '--system-prompt', readFileSync(this.opts.promptFile, 'utf8').replaceAll('{{NAME}}', this.opts.name ?? 'Jarvis'),
      '--json-schema', JSON.stringify(OPS_SCHEMA),
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.bin, args, { cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), this.opts.timeoutSec * 1000)
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          const d = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: SleepOps }
          if (d.is_error || !d.structured_output) throw new Error(d.result || 'no structured output')
          resolve(d.structured_output)
        } catch (e) {
          reject(new Error(`sleep model failed (exit ${code}): ${(e as Error).message} ${err.slice(0, 300)}`.trim()))
        }
      })
      child.stdin.end(prompt)
    })
  }
}

export interface DayResult {
  date: string
  from: number
  to: number
  added: number
  superseded: number
  staled: number
  merged: number
  /** Operations refused by validation, with the reason. */
  skipped: string[]
  digest: string
  digestId: number | null
}

export interface SleepResult {
  days: DayResult[]
  dryRun: boolean
  /** Proposed operations, per day (for --dry-run). */
  proposals: { date: string; ops: SleepOps }[]
}

/** Ledger entries worth consolidating: what was said, decided and reported, not plumbing. */
export function sleepInput(e: LedgerEntry): boolean {
  switch (e.kind) {
    case 'owner':
    case 'decision':
    case 'task':
      return true
    case 'captain':
      return !e.meta?.silent
    case 'agent':
      return ['report', 'needs', 'exit', 'error'].includes(String(e.meta?.event))
    case 'fact':
      // Facts the sleep itself wrote are not news.
      return e.session !== SLEEP_SESSION
    default:
      return false
  }
}

/** Local calendar day of an ISO timestamp. */
export function localDay(ts: string): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildDayPrompt(date: string, entries: LedgerEntry[], facts: Fact[]): string {
  const ledger = entries
    .map((e) => {
      const text = e.text.length > ENTRY_CHARS ? `${e.text.slice(0, ENTRY_CHARS)} ...[cut]` : e.text
      return `[L${e.id} ${new Date(e.ts).toTimeString().slice(0, 5)} ${e.kind}] ${text}`
    })
    .join('\n')
  const known = facts.length ? facts.map((f) => `F${f.id} [${f.kind}] ${f.subject}: ${f.body} (source ${f.source}, ${f.updated_at.slice(0, 10)})`).join('\n') : '(none yet)'
  return `<day date="${date}">\n<ledger>\n${ledger}\n</ledger>\n<facts>\n${known}\n</facts>\n</day>`
}

/** Facts to show the model: all of them while memory is small, otherwise the ones relevant to the day. */
function factsFor(mem: Memory, entries: LedgerEntry[]): Fact[] {
  const all = mem.factsAll()
  const size = all.reduce((n, f) => n + f.subject.length + f.body.length + 40, 0)
  if (size <= ALL_FACTS_CHARS) return all
  const ids = new Set<number>()
  const text = entries.map((e) => e.text.slice(0, 500)).join('\n')
  for (const h of mem.searchFacts(text, 80)) ids.add(Number(h.ref.slice(1)))
  for (const f of all.slice(-40)) ids.add(f.id)
  return all.filter((f) => ids.has(f.id))
}

/** Checks proposed operations against the day and the facts; returns what is safe to apply. */
export function validate(ops: SleepOps, dayIds: Set<number>, mem: Memory): { ok: SleepOps; skipped: string[] } {
  const skipped: string[] = []
  const used = new Set<number>()
  const ok: SleepOps = { add: [], supersede: [], stale: [], merge: [], digest: (ops.digest ?? '').trim() }

  const sourceOk = (s: string) => {
    const m = /^L(\d+)$/.exec(String(s).trim())
    return !!m && dayIds.has(Number(m[1]))
  }
  const liveFact = (ref: string): number | null => {
    const m = /^F(\d+)$/.exec(String(ref).trim())
    if (!m) return null
    const f = mem.factGet(Number(m[1]))
    return f && !f.stale && !used.has(f.id) ? f.id : null
  }
  const shapeOk = (f: NewFact) =>
    FACT_KINDS.includes(f.kind) && f.subject?.trim().length > 0 && f.subject.length <= 120 && f.body?.trim().length > 0 && f.body.length <= 1500

  for (const f of ops.add ?? []) {
    if (!shapeOk(f)) skipped.push(`add "${f.subject}": bad kind, subject or body`)
    else if (!sourceOk(f.source)) skipped.push(`add "${f.subject}": source ${f.source} is not in this day`)
    else ok.add.push(f)
  }
  for (const f of ops.supersede ?? []) {
    const ids = (f.replaces ?? []).map(liveFact)
    if (!shapeOk(f)) skipped.push(`supersede "${f.subject}": bad kind, subject or body`)
    else if (!sourceOk(f.source)) skipped.push(`supersede "${f.subject}": source ${f.source} is not in this day`)
    else if (!ids.length || ids.some((i) => i === null)) skipped.push(`supersede "${f.subject}": replaces ${f.replaces?.join(', ')} - not all live facts`)
    else {
      ids.forEach((i) => used.add(i!))
      ok.supersede.push(f)
    }
  }
  for (const s of ops.stale ?? []) {
    const id = liveFact(s.id)
    if (id === null) skipped.push(`stale ${s.id}: not a live fact`)
    else if (!s.reason?.trim()) skipped.push(`stale ${s.id}: no reason`)
    else {
      used.add(id)
      ok.stale.push(s)
    }
  }
  for (const m of ops.merge ?? []) {
    const keep = liveFact(m.keep)
    const drops = (m.drop ?? []).map(liveFact)
    if (keep === null || !drops.length || drops.some((d) => d === null || d === keep)) skipped.push(`merge ${m.drop?.join(', ')} into ${m.keep}: not all live, distinct facts`)
    else {
      used.add(keep)
      drops.forEach((d) => used.add(d!))
      ok.merge.push(m)
    }
  }
  return { ok, skipped }
}

const num = (ref: string) => Number(String(ref).trim().slice(1))

function apply(mem: Memory, ops: SleepOps): Pick<DayResult, 'added' | 'superseded' | 'staled' | 'merged'> {
  for (const f of ops.add) mem.factWrite({ kind: f.kind, subject: f.subject.trim(), body: f.body.trim(), source: f.source.trim() }, SLEEP_SESSION)
  for (const f of ops.supersede)
    mem.factWrite({ kind: f.kind, subject: f.subject.trim(), body: f.body.trim(), source: f.source.trim(), supersedes: f.replaces.map(num) }, SLEEP_SESSION)
  for (const s of ops.stale) mem.factMarkStale(num(s.id), s.reason.trim(), SLEEP_SESSION)
  for (const m of ops.merge) for (const d of m.drop) mem.factMerge(num(d), num(m.keep), SLEEP_SESSION)
  return {
    added: ops.add.length,
    superseded: ops.supersede.reduce((n, f) => n + f.replaces.length, 0),
    staled: ops.stale.length,
    merged: ops.merge.reduce((n, m) => n + m.drop.length, 0),
  }
}

export function summaryLine(r: Pick<DayResult, 'added' | 'superseded' | 'staled' | 'merged'>): string {
  const parts = [
    r.added && `${r.added} new ${r.added === 1 ? 'fact' : 'facts'}`,
    r.superseded && `${r.superseded} updated`,
    r.staled && `${r.staled} outdated`,
    r.merged && `${r.merged} merged`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'nothing to change'
}

/**
 * Consolidates everything since the last sleep, one local day at a time. The
 * cursor moves only after a day is fully applied, so a failed run is retried.
 */
export async function runSleep(mem: Memory, model: SleepModel, opts: { dryRun?: boolean; maxChars?: number } = {}): Promise<SleepResult> {
  const cursor = Number(mem.metaGet(CURSOR) ?? 0)
  const fresh = mem.ledgerSince(cursor)
  const lastId = fresh.at(-1)?.id ?? cursor
  const result: SleepResult = { days: [], dryRun: !!opts.dryRun, proposals: [] }

  const byDay = new Map<string, LedgerEntry[]>()
  for (const e of fresh.filter(sleepInput)) {
    const day = localDay(e.ts)
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }

  for (const [date, entries] of byDay) {
    // Very long days are read in parts; facts written by one part are seen by the next.
    const parts = chunk(entries, opts.maxChars ?? 60_000)
    const day: DayResult = { date, from: entries[0].id, to: entries.at(-1)!.id, added: 0, superseded: 0, staled: 0, merged: 0, skipped: [], digest: '', digestId: null }
    const digests: string[] = []
    for (const part of parts) {
      const ops = await model.consolidate(buildDayPrompt(date, part, factsFor(mem, part)))
      result.proposals.push({ date, ops })
      const { ok, skipped } = validate(ops, new Set(part.map((e) => e.id)), mem)
      day.skipped.push(...skipped)
      if (ok.digest) digests.push(ok.digest)
      if (opts.dryRun) continue
      const n = apply(mem, ok)
      day.added += n.added
      day.superseded += n.superseded
      day.staled += n.staled
      day.merged += n.merged
    }
    day.digest = digests.join('\n\n')
    if (!opts.dryRun) {
      const entry = mem.append('digest', `Digest ${date}: ${day.digest || '(no digest)'}\n\nMemory: ${summaryLine(day)}.`, {
        session: SLEEP_SESSION,
        meta: { date, from: day.from, to: day.to, added: day.added, superseded: day.superseded, staled: day.staled, merged: day.merged, skipped: day.skipped },
      })
      day.digestId = entry.id
      mem.metaSet(CURSOR, String(day.to))
    }
    result.days.push(day)
  }
  // Every day applied: skip past trailing plumbing too (rotations, Now updates).
  if (!opts.dryRun && lastId > Number(mem.metaGet(CURSOR) ?? 0)) mem.metaSet(CURSOR, String(lastId))
  return result
}

function chunk(entries: LedgerEntry[], maxChars: number): LedgerEntry[][] {
  const out: LedgerEntry[][] = []
  let cur: LedgerEntry[] = []
  let size = 0
  for (const e of entries) {
    const n = Math.min(e.text.length, ENTRY_CHARS) + 40
    if (cur.length && size + n > maxChars) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(e)
    size += n
  }
  if (cur.length) out.push(cur)
  return out
}
