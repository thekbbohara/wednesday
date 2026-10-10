// Writes the first version of a project page from what memory already holds:
// the facts, tasks and ledger entries a search for the project finds. Same
// model and the same validation as the background pass (every cited id must
// exist), so a seeded page is as checkable as one written later.
import type { Memory, Task } from '../memory/store.ts'
import type { Pages, Page } from '../memory/pages.ts'
import type { HybridSearch } from '../memory/vectors.ts'
import { buildDayPrompt, localDay, type ModelUsage, type SleepModel } from './sleep.ts'

export interface SeedResult {
  page: Page | null
  /** Why no page was written. */
  error?: string
  usage?: ModelUsage
}

export async function seedPage(
  mem: Memory,
  pages: Pages,
  search: HybridSearch,
  model: SleepModel,
  spec: { slug: string; title: string; keywords: string[] },
  opts: { dryRun?: boolean } = {},
): Promise<SeedResult & { body?: string }> {
  const query = [spec.title, ...spec.keywords].join(' ')
  const facts = (await search.searchFacts(query, 25)).map((h) => mem.factGet(Number(h.ref.slice(1)))!).filter(Boolean)
  const tasks = (await search.search(query, { scope: 'tasks', limit: 12 })).map((h) => mem.taskGet(Number(h.ref.slice(1)))!).filter(Boolean)
  const ledger = (await search.searchLedger(query, 15, { kinds: ['owner', 'captain', 'decision', 'agent', 'digest'] }))
    .map((h) => mem.ledgerGet(Number(h.ref.slice(1)))!)
    .filter(Boolean)
    .sort((a, b) => a.id - b.id)
  if (!facts.length && !tasks.length && !ledger.length) return { page: null, error: `memory has nothing about "${query}"` }

  const taskLines = tasks.map((t: Task) => `T${t.id} [${t.status}] ${t.title}. Goal: ${t.goal}${t.result ? ` Result: ${t.result}` : ''} (updated ${t.updated_at.slice(0, 10)})`)
  const pass =
    `<pass>Seed one project page, not a day: slug "${spec.slug}", title "${spec.title}", keywords ${JSON.stringify(spec.keywords)}. ` +
    'Write its first version from the records below and return it as the only item in pages, with that slug, title and keywords. ' +
    'Leave every other list empty and the digest empty. Cite only ids shown here.</pass>'
  const day = buildDayPrompt(localDay(new Date().toISOString()), ledger, facts, `\n<tasks>\n${taskLines.join('\n') || '(none)'}\n</tasks>`)
  const out = await model.consolidate(`${pass}\n${day}`, { extract: true })
  const op = out.pages?.find((p) => p.slug === spec.slug) ?? out.pages?.[0]
  if (!op) return { page: null, error: 'the model returned no page', usage: out.usage }
  if (opts.dryRun) return { page: null, body: op.body, usage: out.usage }
  try {
    const page = pages.update(mem, spec.slug, { title: spec.title, keywords: spec.keywords, body: op.body, note: 'seeded from memory' }, 'sleep')
    return { page, usage: out.usage }
  } catch (e) {
    return { page: null, error: (e as Error).message, body: op.body, usage: out.usage }
  }
}
