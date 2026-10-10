// Retrieval quality for per-message recall: keyword FTS5 with porter stemming.
// "direct" questions share at least one content word with the fact (the normal
// case: owners reuse their own nouns). "paraphrase" questions share none; they
// measure where keyword recall stops and embeddings would be needed.
import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { Memory } from '../src/memory/store.ts'
import { DEFAULT_EMBED_MODEL, HybridSearch, indexPending, LocalEmbedder, VectorIndex } from '../src/memory/vectors.ts'

const FACTS: [kind: 'owner' | 'person' | 'project' | 'preference' | 'decision', subject: string, body: string][] = [
  ['owner', 'owner home city', 'The owner lives in Kathmandu, Nepal (NPT, UTC+5:45).'],
  ['owner', 'income goal', 'Target income is 100,000 NPR per month from own products.'],
  ['owner', 'gpu', 'Workstation GPU is a GTX 1060 (Pascal, sm_61); CUDA 13 torch wheels do not support it.'],
  ['preference', 'dash style', 'Never use the em dash; use a plain dash.'],
  ['preference', 'browser automation', 'Use obscura-browser for headless scraping instead of chromium.'],
  ['preference', 'deployment', 'Everything should be easy to customize and deploy, preferably with Docker.'],
  ['preference', 'ui quality', 'The owner is picky about UI and wants pixel-perfect layouts.'],
  ['preference', 'migrations', 'Never run database migrations; prepare SQL and give the owner the command.'],
  ['person', 'Sita', 'Sita is the designer for StockMate; reach her on WhatsApp.'],
  ['person', 'Ramesh', 'Ramesh owns the portfolio-nepal client account and pays monthly.'],
  ['person', 'accountant', 'The accountant Bikash files VAT returns by the 25th of each month.'],
  ['project', 'stockmate', 'StockMate is a paid inventory app for a retail client; Next.js + Postgres.'],
  ['project', 'portfolio-nepal', 'portfolio-nepal tracks NEPSE share portfolios and cash dividends.'],
  ['project', 'agent-hq', 'agent-hq runs coding agents in tmux on a private socket; replaced OpenRig.'],
  ['project', 'majordomo', 'Wednesday is the single-chat captain with layered memory and session rotation.'],
  ['project', 'voiceclip', 'voiceclip turns voice notes into short captioned clips (Blacknote brand).'],
  ['project', 'nepal-police-surveillance', 'Research project detecting vehicles in traffic footage with YOLO.'],
  ['decision', 'majordomo captain runtime', 'Captain runs headless (claude -p with resume) because usage per turn is exact and rotation is trivial.'],
  ['decision', 'majordomo memory backend', 'Memory uses SQLite FTS5 in one file; embeddings only if keyword recall proves insufficient.'],
  ['decision', 'stockmate hosting', 'StockMate is hosted on a Hetzner VPS with Docker Compose, not Vercel, to keep Postgres local.'],
  ['decision', 'portfolio-nepal data source', 'Dividend data is scraped from ShareSansar nightly; MeroLagani was too unreliable.'],
  ['decision', 'social posting cadence', 'Post to Instagram and Threads three times a week, reels on Fridays.'],
  ['decision', 'video framework', 'Videos are built with HyperFrames, not Remotion.'],
  ['project', 'jira site', 'Jira lives at example.atlassian.net; branch names equal ticket keys.'],
  ['owner', 'working hours', 'The owner works late, usually 14:00 to 02:00 NPT.'],
  ['preference', 'reports', 'Reports should be short; long plans go into an HTML page for review.'],
  ['person', 'Anil', 'Anil is a friend who tests apps on Android; prefers Viber over WhatsApp.'],
  ['project', 'kokoro tts', 'Hyperframes TTS uses Kokoro via a throwaway venv because espeak paths are hardcoded.'],
  ['decision', 'agent delegation', 'Unattended file-writing work goes to pi with deepseek, not kimi.'],
  ['owner', 'bank', 'Business account is at NIC Asia; invoices are in NPR.'],
]

// [question, subject of the fact that must be recalled]
const DIRECT: [string, string][] = [
  ['Where does the owner live?', 'owner home city'],
  ['what is my monthly income target', 'income goal'],
  ['can I train with CUDA 13 on my GPU', 'gpu'],
  ['which browser should the scraper use', 'browser automation'],
  ['how should we deploy this', 'deployment'],
  ['who is Sita', 'Sita'],
  ['when does Bikash file VAT', 'accountant'],
  ['what stack is StockMate on', 'stockmate'],
  ['remind me what portfolio-nepal does', 'portfolio-nepal'],
  ['why does the captain run headless?', 'majordomo captain runtime'],
  ['why did we pick SQLite for memory', 'majordomo memory backend'],
  ['where is stockmate hosted and why not vercel', 'stockmate hosting'],
  ['where do we scrape dividends from', 'portfolio-nepal data source'],
  ['how often do we post on Instagram', 'social posting cadence'],
  ['should I use Remotion for this video', 'video framework'],
  ['what is the jira url', 'jira site'],
  ['does Anil use WhatsApp', 'Anil'],
  ['tts is broken again, espeak error', 'kokoro tts'],
  ['should kimi do this unattended job', 'agent delegation'],
  ['which bank for invoices', 'bank'],
  ['can you run the migration on the db', 'migrations'],
  ['what did agent-hq replace', 'agent-hq'],
]

const PARAPHRASE: [string, string][] = [
  ['what time zone am I in', 'owner home city'],
  ['how much money am I trying to make', 'income goal'],
  ['what graphics card do I have', 'gpu'],
  ['who handles my taxes', 'accountant'],
  ['who designs for me', 'Sita'],
  ['what do I care about in interfaces', 'ui quality'],
]

function seed(): { mem: Memory; idOf: Map<string, string> } {
  const mem = new Memory(':memory:')
  const idOf = new Map<string, string>()
  for (const [kind, subject, body] of FACTS) idOf.set(subject, `F${mem.factWrite({ kind, subject, body, source: 'owner' }).id}`)
  // Ledger noise so ranking is not trivially easy.
  for (let i = 0; i < 300; i++) mem.append(i % 2 ? 'captain' : 'owner', `routine update ${i}: checked builds, owner asked about status, agent finished lint run`)
  return { mem, idOf }
}

function hitRate(mem: Memory, idOf: Map<string, string>, set: [string, string][], k: number) {
  const misses: string[] = []
  for (const [q, subject] of set) {
    const refs = mem.searchFacts(q, k).map((h) => h.ref)
    if (!refs.includes(idOf.get(subject)!)) misses.push(`${q} -> ${subject}`)
  }
  return { rate: 1 - misses.length / set.length, misses }
}

describe('retrieval quality', () => {
  const { mem, idOf } = seed()

  it('recalls the right fact for direct questions (hit@6 = recall budget)', () => {
    const r = hitRate(mem, idOf, DIRECT, 6)
    expect(r.misses).toEqual([])
  })

  it('ranks the right fact first for most direct questions (hit@1 >= 85%)', () => {
    const r = hitRate(mem, idOf, DIRECT, 1)
    console.info(`hit@1 direct: ${(r.rate * 100).toFixed(0)}%`, r.misses)
    expect(r.rate).toBeGreaterThanOrEqual(0.85)
  })

  it('measures paraphrase recall (informational: keyword search is expected to miss these)', () => {
    const r = hitRate(mem, idOf, PARAPHRASE, 6)
    console.info(`hit@6 paraphrase: ${(r.rate * 100).toFixed(0)}%`, r.misses)
    expect(r.rate).toBeGreaterThanOrEqual(0)
  })
})

// The same questions through hybrid search with the real local model. Needs the
// model on disk (no download in tests): WEDNESDAY_LIVE_MODELS=<dir with Xenova/...>.
const MODELS = process.env.WEDNESDAY_LIVE_MODELS
describe.skipIf(!MODELS || !existsSync(`${MODELS}/${DEFAULT_EMBED_MODEL}`))('retrieval quality, hybrid (real embedding model)', () => {
  const { mem, idOf } = seed()
  // Built in beforeAll: a skipped describe still runs its body, so nothing may start loading here.
  let search: HybridSearch
  beforeAll(async () => {
    const idx = new VectorIndex(':memory:', DEFAULT_EMBED_MODEL)
    const emb = new LocalEmbedder({ cacheDir: MODELS!, download: false })
    await indexPending(mem, idx, emb)
    search = new HybridSearch(mem, idx, emb)
  }, 120_000)
  const rate = async (set: [string, string][], k: number) => {
    const misses: string[] = []
    for (const [q, subject] of set) if (!(await search.searchFacts(q, k)).map((h) => h.ref).includes(idOf.get(subject)!)) misses.push(`${q} -> ${subject}`)
    return { rate: 1 - misses.length / set.length, misses }
  }

  it('loses nothing on direct questions', { timeout: 120_000 }, async () => {
    expect((await rate(DIRECT, 6)).misses).toEqual([])
    const top = await rate(DIRECT, 1)
    console.info(`hybrid hit@1 direct: ${(top.rate * 100).toFixed(0)}%`, top.misses)
    expect(top.rate).toBeGreaterThanOrEqual(0.85)
  })

  it('finds paraphrases keyword search misses', { timeout: 120_000 }, async () => {
    const kw = hitRate(mem, idOf, PARAPHRASE, 6)
    const hy = await rate(PARAPHRASE, 6)
    console.info(`hit@6 paraphrase: keyword ${(kw.rate * 100).toFixed(0)}%, hybrid ${(hy.rate * 100).toFixed(0)}%`, hy.misses)
    expect(hy.rate).toBeGreaterThan(kw.rate)
  })
})
