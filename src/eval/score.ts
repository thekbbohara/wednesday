// Scores captain answers to probes against what the ledger says.
import type { Memory } from '../memory/store.ts'
import type { Expect, Turn } from './scenario.ts'

export type Outcome = 'correct' | 'stale' | 'refused' | 'wrong' | 'hallucinated'

export interface Verdict {
  outcome: Outcome
  /** Ids the answer cites, like F3 or L42. */
  cited: string[]
  /** Every cited id exists. */
  citesExist: boolean
  /** At least one cited record itself contains the expected answer. */
  citesSupport: boolean
}

const REFUSAL = /\b(?:i )?(?:don'?t|do not) have (?:that|this|it|any|a record|anything)|\bno record\b|\bnot (?:something )?(?:you'?ve|you have) (?:told|mentioned|shared)|\byou (?:haven'?t|have not|never) (?:told|mentioned|shared|said)|\bi(?:'m| am) not (?:aware|sure)|\bnothing (?:in|on) (?:memory|record)|\bcan'?t find\b|\bno (?:information|mention)\b/i

export function matches(text: string, expect: Expect): boolean {
  const t = text.toLowerCase()
  return expect.every((group) => group.some((w) => t.includes(w.toLowerCase())))
}

export function citations(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\[([FTL]\d+(?:\s*,\s*[FTL]\d+)*)\]/g)) for (const id of m[1].split(/\s*,\s*/)) out.add(id)
  return [...out]
}

/** Text of a cited record, for checking that it backs the claim. */
function recordText(mem: Memory, ref: string): string | null {
  const got = mem.get(ref)
  if (!got) return null
  const r = got.record as Record<string, unknown>
  if (got.kind === 'fact') return `${r.subject} ${r.body}`
  if (got.kind === 'task') return `${r.title} ${r.goal} ${r.plan} ${r.result}`
  return String(r.text)
}

export function score(turn: Turn, answer: string, mem: Memory): Verdict {
  const probe = turn.probe!
  const cited = citations(answer)
  const texts = cited.map((c) => recordText(mem, c))
  const citesExist = texts.every((t) => t !== null)
  const citesSupport = probe.expect.length > 0 && texts.some((t) => t !== null && matches(t, probe.expect))
  const refused = REFUSAL.test(answer)

  let outcome: Outcome
  if (probe.kind === 'never-said') outcome = refused ? 'correct' : 'hallucinated'
  else if (matches(answer, probe.expect)) outcome = 'correct'
  else if (probe.old && probe.old.some((w) => answer.toLowerCase().includes(w.toLowerCase()))) outcome = 'stale'
  else outcome = refused ? 'refused' : 'wrong'
  return { outcome, cited, citesExist, citesSupport }
}
