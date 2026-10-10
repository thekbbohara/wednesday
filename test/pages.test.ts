import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { citedRefs, PAGE_BUDGET, Pages } from '../src/memory/pages.ts'
import { HybridSearch } from '../src/memory/vectors.ts'
import { buildTurnPrompt, newView } from '../src/captain/prompt.ts'
import { pagesBlock, runExtract, runSleep, type SleepModel, type SleepOps } from '../src/sleep/sleep.ts'
import { seedPage } from '../src/sleep/seed.ts'

const none: SleepOps = { add: [], supersede: [], stale: [], merge: [], digest: '' }

class Scripted implements SleepModel {
  prompts: string[] = []
  private reply: (prompt: string) => SleepOps
  constructor(reply: (prompt: string) => SleepOps) {
    this.reply = reply
  }
  async consolidate(prompt: string) {
    this.prompts.push(prompt)
    return this.reply(prompt)
  }
}

const setup = () => {
  const mem = new Memory(':memory:')
  const pages = new Pages(':memory:')
  const f = mem.factWrite({ kind: 'project', subject: 'ClipCrew studio', body: 'Desktop-style app at 127.0.0.1:8761', source: 'owner' })
  const t = mem.taskCreate({ title: 'ClipCrew A/B review', goal: 'pick the best cut' })
  return { mem, pages, f, t }
}

const page = (body: string) => ({ title: 'ClipCrew', keywords: ['clipcrew', 'clip crew'], body })

describe('pages', () => {
  it('creates, versions and logs a page that cites real ids', () => {
    const { mem, pages, f, t } = setup()
    const p = pages.update(mem, 'clipcrew', page(`Studio app [F${f.id}], review open [T${t.id}].`), 'sess-1')
    expect(p).toMatchObject({ slug: 'clipcrew', version: 1, updated_by: 'sess-1', keywords: ['clipcrew', 'clip crew'] })
    const p2 = pages.update(mem, 'clipcrew', { body: `Studio app [F${f.id}]. Review done [T${t.id}].`, note: 'review finished' })
    expect(p2.version).toBe(2)
    expect(p2.title).toBe('ClipCrew')
    expect(pages.history('clipcrew').map((v) => v.note)).toEqual(['review finished', 'created'])
    const [log] = mem.ledgerTail(1, ['page'])
    expect(log.text).toBe('Page clipcrew v2 (ClipCrew): review finished')
    expect(log.meta).toMatchObject({ page: 'clipcrew', version: 2, refs: [`F${f.id}`, `T${t.id}`] })
    // Same content again is not a new version.
    expect(pages.update(mem, 'clipcrew', { body: `Studio app [F${f.id}]. Review done [T${t.id}].` }).version).toBe(2)
  })

  it('refuses bad slugs, missing title or keywords, no citations, unknown ids and oversize bodies', () => {
    const { mem, pages, f } = setup()
    const ok = `x [F${f.id}]`
    expect(() => pages.update(mem, 'Clip Crew!', page(ok))).toThrow(/slug/)
    expect(() => pages.update(mem, 'clipcrew', { keywords: ['x'], body: ok })).toThrow(/title/)
    expect(() => pages.update(mem, 'clipcrew', { title: 'C', body: ok })).toThrow(/keywords/)
    expect(() => pages.update(mem, 'clipcrew', page('no citations here'))).toThrow(/must cite/)
    expect(() => pages.update(mem, 'clipcrew', page(`[F${f.id}] and [T999] [L5000]`))).toThrow(/do not exist: T999, L5000/)
    expect(() => pages.update(mem, 'clipcrew', page(`[F${f.id}] ${'x'.repeat(PAGE_BUDGET)}`))).toThrow(/budget/)
    expect(pages.list()).toEqual([])
  })

  it('matches messages by keyword, title or slug, as whole words', () => {
    const { mem, pages, f } = setup()
    pages.update(mem, 'clipcrew', page(`[F${f.id}]`))
    pages.update(mem, 'pc-health', { title: 'PC health', keywords: ['ssd', 'nvme', 'freeze'], body: `[F${f.id}]` })
    expect(pages.match('how is ClipCrew doing?').map((p) => p.slug)).toEqual(['clipcrew'])
    expect(pages.match('the NVMe SSD froze').map((p) => p.slug)).toEqual(['pc-health'])
    expect(pages.match('pc health check').map((p) => p.slug)).toEqual(['pc-health'])
    expect(pages.match('assdfg clipcrewish')).toEqual([])
  })

  it('finds cited ids', () => {
    expect(citedRefs('see [F1], T22 and L300; not FT1 or F')).toEqual(['F1', 'T22', 'L300'])
  })
})

describe('pages in the captain prompt', () => {
  it('loads the page a message is about, once per version, and lists pages in a fresh session', async () => {
    const { mem, pages, f } = setup()
    const cfg = loadConfig({ dataDir: '/tmp/unused' })
    pages.update(mem, 'clipcrew', page(`Studio app [F${f.id}].`))
    const view = newView()
    const search = new HybridSearch(mem, null, null)
    const p1 = await buildTurnPrompt(mem, cfg, [mem.append('owner', 'any news on clipcrew?')], view, 's', null, search, pages)
    expect(p1.text).toMatch(/<project_pages note="read one with page_get">\nclipcrew: ClipCrew\n<\/project_pages>/)
    expect(p1.text).toMatch(/<page slug="clipcrew" title="ClipCrew" version="1"/)
    expect(p1.injected).toContain('P:clipcrew')
    const p2 = await buildTurnPrompt(mem, cfg, [mem.append('owner', 'and clipcrew exports?')], view, 's', null, search, pages)
    expect(p2.text).not.toMatch(/<page slug/)
    pages.update(mem, 'clipcrew', { body: `Studio app moved [F${f.id}].` })
    const p3 = await buildTurnPrompt(mem, cfg, [mem.append('owner', 'clipcrew again')], view, 's', null, search, pages)
    expect(p3.text).toMatch(/version="2"[^]*Studio app moved/)
    const p4 = await buildTurnPrompt(mem, cfg, [mem.append('owner', 'what is the weather')], newView(), 's', null, search, pages)
    expect(p4.text).not.toMatch(/<page slug/)
  })
})

describe('pages kept current by consolidation', () => {
  it('shows the touched pages to the model and applies its rewrite, refusing bad ones', async () => {
    const { mem, pages, f } = setup()
    pages.update(mem, 'clipcrew', page(`Studio app [F${f.id}].`))
    const said = mem.append('owner', 'clipcrew export to 9:16 works now')
    const model = new Scripted(() => ({
      ...none,
      pages: [
        { slug: 'clipcrew', body: `Studio app [F${f.id}]. 9:16 export works [L${said.id}].`, note: 'export works' },
        { slug: 'ghost', title: 'Ghost', keywords: ['ghost'], body: 'cites nothing' },
      ],
    }))
    const r = await runExtract(mem, model, { pages })
    expect(model.prompts[0]).toMatch(/<pages>\nclipcrew: ClipCrew \[clipcrew, clip crew\]\n<page slug="clipcrew"/)
    expect(r.pages).toBe(1)
    expect(r.skipped).toEqual(['page ghost: a page must cite the facts, tasks or ledger entries it rests on, e.g. [F12] [T3] [L120]'])
    expect(pages.get('clipcrew')!.body).toMatch(/9:16 export works/)
    expect(pages.get('clipcrew')!.updated_by).toBe('sleep')
  })

  it('the nightly sleep updates pages too, and caps writes per answer', async () => {
    const { mem, pages, f } = setup()
    const said = mem.append('owner', 'new projects everywhere')
    const body = `x [F${f.id}] [L${said.id}]`
    const model = new Scripted(() => ({
      ...none,
      digest: 'busy day',
      pages: ['a1', 'a2', 'a3', 'a4'].map((slug) => ({ slug, title: slug, keywords: [slug], body })),
    }))
    const r = await runSleep(mem, model, { pages })
    expect(r.days[0].pages).toBe(3)
    expect(r.days[0].skipped).toEqual(['page a4: more than 3 page writes in one pass'])
    expect(mem.ledgerTail(1, ['digest'])[0].text).toMatch(/3 project pages updated/)
  })

  it('without pages the prompt has no pages block', () => {
    expect(pagesBlock(null, [])).toBe('')
  })
})

describe('seedPage', () => {
  it('writes a first version from what memory finds, validated like any page', async () => {
    const { mem, pages, f, t } = setup()
    const model = new Scripted((p) => {
      expect(p).toMatch(/Seed one project page/)
      expect(p).toMatch(new RegExp(`T${t.id} \\[open\\] ClipCrew A/B review`))
      return { ...none, pages: [{ slug: 'clipcrew', body: `Studio [F${f.id}], review [T${t.id}].` }] }
    })
    const r = await seedPage(mem, pages, new HybridSearch(mem, null, null), model, { slug: 'clipcrew', title: 'ClipCrew', keywords: ['clipcrew'] })
    expect(r.page).toMatchObject({ slug: 'clipcrew', version: 1, title: 'ClipCrew' })
    expect(pages.history('clipcrew')[0].note).toBe('seeded from memory')
    const none2 = await seedPage(mem, pages, new HybridSearch(mem, null, null), model, { slug: 'zzz', title: 'Nothing', keywords: ['qwxyz'] })
    expect(none2.error).toMatch(/nothing about/)
  })
})
