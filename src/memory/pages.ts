// Project pages: one compact, living summary per project (the "scenario"
// layer between atomic facts and the Now note). Each page cites the facts,
// tasks and ledger entries it rests on, so every line can be checked. Pages
// live in a sidecar file (memory-pages.db) with every version kept; each
// change is also noted in the ledger, so it can be searched and cited.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { plainDash } from '../text.ts'
import type { Memory } from './store.ts'

/** Max characters of a page body: a page is a summary, detail stays in facts and the ledger. */
export const PAGE_BUDGET = 2500
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/

export interface Page {
  slug: string
  title: string
  /** Words or phrases that mean a message is about this project. */
  keywords: string[]
  body: string
  version: number
  updated_at: string
  updated_by: string | null
}

export interface PageVersion {
  slug: string
  version: number
  title: string
  body: string
  note: string
  ts: string
  by: string | null
}

export interface PagePatch {
  title?: string
  keywords?: string[]
  body: string
  note?: string
}

/** F/T/L ids cited in a text. */
export function citedRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\b([FTL])(\d+)\b/g)].map((m) => `${m[1]}${m[2]}`))]
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `

export class Pages {
  readonly db: DatabaseSync
  private clock: () => Date

  constructor(path: string, opts: { clock?: () => Date } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.clock = opts.clock ?? (() => new Date())
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS pages(
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        keywords TEXT NOT NULL,
        body TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS page_versions(
        slug TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        note TEXT NOT NULL,
        ts TEXT NOT NULL,
        by TEXT,
        PRIMARY KEY (slug, version)
      );`)
  }

  close(): void {
    this.db.close()
  }

  list(): Page[] {
    return (this.db.prepare('SELECT * FROM pages ORDER BY slug').all() as Record<string, unknown>[]).map(toPage)
  }

  get(slug: string): Page | null {
    const r = this.db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug.toLowerCase()) as Record<string, unknown> | undefined
    return r ? toPage(r) : null
  }

  history(slug: string, limit = 10): PageVersion[] {
    return this.db.prepare('SELECT * FROM page_versions WHERE slug = ? ORDER BY version DESC LIMIT ?').all(slug, limit) as unknown as PageVersion[]
  }

  /**
   * Create or replace a page. The body must cite at least one F/T/L id, and
   * every id it cites must exist in memory. A new page needs a title and keywords.
   */
  update(mem: Memory, slug: string, patch: PagePatch, by: string | null = null): Page {
    slug = slug.trim().toLowerCase()
    if (!SLUG.test(slug)) throw new Error(`page slug "${slug}" must be 2-40 lowercase letters, digits or dashes, e.g. "clipcrew" or "pc-health"`)
    const cur = this.get(slug)
    const body = plainDash(patch.body.trim())
    const title = plainDash((patch.title ?? cur?.title ?? '').trim())
    const keywords = [...new Set((patch.keywords ?? cur?.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))]
    if (!title) throw new Error(`new page ${slug} needs a title`)
    if (!keywords.length) throw new Error(`page ${slug} needs keywords: words that mean a message is about it`)
    if (!body) throw new Error('page body is empty')
    if (body.length > PAGE_BUDGET) throw new Error(`page is ${body.length} chars, budget is ${PAGE_BUDGET}. Keep the summary; leave detail in facts and the ledger.`)
    const refs = citedRefs(body)
    if (!refs.length) throw new Error('a page must cite the facts, tasks or ledger entries it rests on, e.g. [F12] [T3] [L120]')
    const missing = refs.filter((r) => !mem.get(r))
    if (missing.length) throw new Error(`page cites ids that do not exist: ${missing.join(', ')}`)
    if (cur && cur.body === body && cur.title === title && cur.keywords.join() === keywords.join()) return cur

    const version = (cur?.version ?? 0) + 1
    const ts = this.clock().toISOString()
    const note = plainDash((patch.note ?? '').trim()) || (cur ? 'updated' : 'created')
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO pages(slug, title, keywords, body, version, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET title = excluded.title, keywords = excluded.keywords, body = excluded.body,
             version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .run(slug, title, JSON.stringify(keywords), body, version, ts, by)
      this.db.prepare('INSERT INTO page_versions(slug, version, title, body, note, ts, by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(slug, version, title, body, note, ts, by)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    mem.append('page', `Page ${slug} v${version} (${title}): ${note}`, { session: by, meta: { page: slug, version, refs } })
    return this.get(slug)!
  }

  /** Pages a text is about: a keyword, the title or the slug appears in it. Most matches first. */
  match(text: string, limit = 2): Page[] {
    const t = norm(text)
    return this.list()
      .map((p) => ({ p, n: [p.slug.replace(/-/g, ' '), p.title, ...p.keywords].filter((k) => norm(k).trim() && t.includes(norm(k))).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, limit)
      .map((x) => x.p)
  }
}

function toPage(r: Record<string, unknown>): Page {
  return {
    slug: String(r.slug),
    title: String(r.title),
    keywords: JSON.parse(String(r.keywords)) as string[],
    body: String(r.body),
    version: Number(r.version),
    updated_at: String(r.updated_at),
    updated_by: (r.updated_by as string | null) ?? null,
  }
}

export function fmtPage(p: Page): string {
  return `<page slug="${p.slug}" title="${p.title}" version="${p.version}" updated="${p.updated_at.slice(0, 10)}">\n${p.body}\n</page>`
}
