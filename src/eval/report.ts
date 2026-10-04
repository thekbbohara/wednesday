// Turns eval rows into numbers and a readable report.
import type { Memory } from '../memory/store.ts'
import type { Phrasing, ProbeKind, Turn } from './scenario.ts'
import type { Outcome, Verdict } from './score.ts'

export type Row =
  | {
      type: 'turn'
      index: number
      kind: Turn['kind']
      plant: string | null
      probe: Turn['probe'] | null
      text: string
      answer: string
      error: boolean
      attempts: number
      ledgerId: number
      sessionId: string
      contextTokens: number
      rotated: string | null
      ms: number
      verdict: Verdict | null
    }
  | { type: 'sleep'; after: number; days?: { date: string; summary: string; skipped: number }[]; error?: string }

type TurnRow = Extract<Row, { type: 'turn' }>

export interface Bucket {
  name: string
  n: number
  outcomes: Record<Outcome, number>
  accuracy: number
}

export interface Summary {
  setup: { turns: number; seed: number; model: string; sleepEvery: number; plants?: number | null }
  done: number
  errors: number
  sessions: number
  rotations: number
  context: { avg: number; p95: number; max: number }
  seconds: { avg: number; total: number }
  costUsd: number
  buckets: Bucket[]
  citations: { answers: number; citing: number; exist: number; support: number }
  rotationsBetween: { min: number; avg: number }
  sleeps: { ok: number; failed: number; summaries: string[] }
  misses: { index: number; bucket: string; text: string; expect: string; outcome: Outcome; answer: string }[]
  note: string
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0)

function bucketOf(r: TurnRow): string {
  const p = r.probe!
  return p.kind === 'never-said' ? 'never-said' : `${p.kind}/${p.phrasing}`
}

export function summarize(rows: Row[], mem: Memory, setup: Summary['setup']): Summary {
  const turns = rows.filter((r): r is TurnRow => r.type === 'turn').sort((a, b) => a.index - b.index)
  const ok = turns.filter((r) => !r.error)
  const ctx = ok.map((r) => r.contextTokens).sort((a, b) => a - b)
  const probes = turns.filter((r) => r.verdict)

  const names = ['recall/direct', 'recall/paraphrase', 'updated/direct', 'updated/paraphrase', 'never-said']
  const buckets: Bucket[] = names.map((name) => {
    const rs = probes.filter((r) => bucketOf(r) === name)
    const outcomes: Record<Outcome, number> = { correct: 0, stale: 0, refused: 0, wrong: 0, hallucinated: 0 }
    for (const r of rs) outcomes[r.verdict!.outcome]++
    return { name, n: rs.length, outcomes, accuracy: pct(outcomes.correct, rs.length) }
  })

  const answered = probes.filter((r) => r.probe!.kind !== 'never-said' && r.verdict!.outcome === 'correct')
  const citing = answered.filter((r) => r.verdict!.cited.length)

  // Rotations between a plant (or its update) and the probe that asks about it.
  const rotatedAt = turns.filter((r) => r.rotated).map((r) => r.index)
  const sourceAt = new Map<string, number>()
  for (const r of turns) if ((r.kind === 'plant' || r.kind === 'update') && r.plant) sourceAt.set(r.plant, r.index)
  const spans = probes
    .filter((r) => r.plant && sourceAt.has(r.plant))
    .map((r) => rotatedAt.filter((i) => i >= sourceAt.get(r.plant!)! && i < r.index).length)

  const cost = (mem.db.prepare("SELECT coalesce(sum(json_extract(meta, '$.cost_usd')), 0) AS c FROM ledger WHERE kind = 'captain'").get() as { c: number }).c
  const sleeps = rows.filter((r): r is Extract<Row, { type: 'sleep' }> => r.type === 'sleep')

  const misses = probes
    .filter((r) => r.verdict!.outcome !== 'correct')
    .map((r) => ({
      index: r.index,
      bucket: bucketOf(r),
      text: r.text,
      expect: r.probe!.expect.map((g) => g.join(' | ')).join(' AND '),
      outcome: r.verdict!.outcome,
      answer: r.answer.length > 400 ? `${r.answer.slice(0, 400)}...` : r.answer,
    }))

  const by = (n: string) => buckets.find((b) => b.name === n)!
  const direct = by('recall/direct')
  const para = by('recall/paraphrase')
  const gap = Math.round((direct.accuracy - para.accuracy) * 10) / 10
  const note =
    direct.n && para.n
      ? gap > 15
        ? `Paraphrased questions score ${gap} points below direct ones: keyword recall is the bottleneck, so embeddings are worth adding.`
        : `Paraphrased questions score within ${Math.max(gap, 0)} points of direct ones: keyword recall plus the captain's own searches holds up; embeddings are not needed yet.`
      : 'Not enough probes answered yet to compare phrasings.'

  return {
    setup,
    done: turns.length,
    errors: turns.filter((r) => r.error).length,
    sessions: new Set(ok.map((r) => r.sessionId)).size,
    rotations: rotatedAt.length,
    context: {
      avg: ctx.length ? Math.round(ctx.reduce((a, b) => a + b, 0) / ctx.length) : 0,
      p95: ctx.length ? ctx[Math.min(ctx.length - 1, Math.floor(ctx.length * 0.95))] : 0,
      max: ctx.at(-1) ?? 0,
    },
    seconds: { avg: turns.length ? Math.round(turns.reduce((a, r) => a + r.ms, 0) / turns.length / 100) / 10 : 0, total: Math.round(turns.reduce((a, r) => a + r.ms, 0) / 1000) },
    costUsd: Math.round(cost * 100) / 100,
    buckets,
    citations: {
      answers: answered.length,
      citing: pct(citing.length, answered.length),
      exist: pct(citing.filter((r) => r.verdict!.citesExist).length, citing.length),
      support: pct(citing.filter((r) => r.verdict!.citesSupport).length, citing.length),
    },
    rotationsBetween: { min: spans.length ? Math.min(...spans) : 0, avg: spans.length ? Math.round((10 * spans.reduce((a, b) => a + b, 0)) / spans.length) / 10 : 0 },
    sleeps: { ok: sleeps.filter((s) => !s.error).length, failed: sleeps.filter((s) => s.error).length, summaries: sleeps.flatMap((s) => s.days?.map((d) => d.summary) ?? []) },
    misses,
    note,
  }
}

export function renderReport(s: Summary): string {
  const row = (b: Bucket) =>
    `| ${b.name} | ${b.n} | **${b.accuracy}%** | ${b.outcomes.correct} | ${b.outcomes.stale} | ${b.outcomes.refused} | ${b.outcomes.wrong} | ${b.outcomes.hallucinated} |`
  return [
    `# Jarvis long-run eval`,
    '',
    `${s.done}/${s.setup.turns} turns, model ${s.setup.model}, seed ${s.setup.seed}, sleep every ${s.setup.sleepEvery} turns.`,
    '',
    `- Captain sessions: ${s.sessions} (${s.rotations} rotations); probes sat ${s.rotationsBetween.min}-${s.rotationsBetween.avg} (min-avg) rotations after the fact they ask about.`,
    `- Context per turn: avg ${s.context.avg}, p95 ${s.context.p95}, max ${s.context.max} tokens.`,
    `- Time: ${s.seconds.avg}s per turn, ${Math.round(s.seconds.total / 60)} min total. Captain cost: $${s.costUsd}.`,
    `- Turn errors after retries: ${s.errors}. Sleeps: ${s.sleeps.ok} ok, ${s.sleeps.failed} failed${s.sleeps.summaries.length ? ` (${s.sleeps.summaries.join('; ')})` : ''}.`,
    '',
    '## Recall',
    '',
    '| probe | n | accuracy | correct | stale | "don\'t have" | wrong | invented |',
    '|---|---|---|---|---|---|---|---|',
    ...s.buckets.map(row),
    '',
    `Citations on correct answers (${s.citations.answers}): ${s.citations.citing}% cite an id; of those, ${s.citations.exist}% of ids exist and ${s.citations.support}% point at a record that holds the answer.`,
    '',
    s.note,
    '',
    '## Misses',
    '',
    ...(s.misses.length
      ? s.misses.map((m) => `- **#${m.index} ${m.bucket} (${m.outcome})**: ${m.text}\n  - expected: ${m.expect || '"I don\'t have that"'}\n  - answer: ${m.answer.replace(/\n+/g, ' ')}`)
      : ['None.']),
    '',
  ].join('\n')
}

export type { Phrasing, ProbeKind }
