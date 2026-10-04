// Jarvis memory: one SQLite file, four layers (now, facts, tasks, ledger).
// The ledger is append-only and is the source of truth for "what happened";
// facts, tasks and now are the distilled, budgeted views the captain loads.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { plainDash } from '../text.ts'

export const SCHEMA_VERSION = 2

export const LEDGER_KINDS = ['owner', 'captain', 'decision', 'agent', 'task', 'fact', 'now', 'system', 'rotation'] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

export const FACT_KINDS = ['owner', 'person', 'project', 'preference', 'decision', 'other'] as const
export type FactKind = (typeof FACT_KINDS)[number]

export const TASK_STATUSES = ['open', 'running', 'waiting_owner', 'blocked', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const CLOSED_STATUSES: readonly TaskStatus[] = ['done', 'cancelled']

export interface LedgerEntry { id: number; ts: string; kind: LedgerKind; session: string | null; text: string; meta: Record<string, unknown> | null }
export interface Fact { id: number; kind: FactKind; subject: string; body: string; source: string; created_at: string; updated_at: string; stale: boolean; superseded_by: number | null }
export interface Task { id: number; title: string; goal: string; plan: string; status: TaskStatus; result: string; created_at: string; updated_at: string }
export interface Now { text: string; version: number; updated_at: string }
export interface Session { id: string; started_at: string; ended_at: string | null; end_reason: string | null; turns: number; peak_tokens: number; context_window: number | null }

export const AGENT_STATUSES = ['running', 'stopped', 'removed'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]
export interface AgentRow {
  id: string
  task_id: number | null
  runtime: string
  cwd: string
  /** Source repo when the agent works in a worktree Jarvis created. */
  repo: string | null
  branch: string | null
  brief: string
  status: AgentStatus
  created_at: string
  updated_at: string
}

export interface Hit { ref: string; kind: 'fact' | 'ledger' | 'task'; title: string; text: string; date: string; score: number }

export interface StoreOptions {
  /** Max characters of the Now layer (~4 chars per token). */
  nowBudgetChars?: number
  clock?: () => Date
}

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE ledger(
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  session TEXT,
  text TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX ledger_kind ON ledger(kind, id);
CREATE VIRTUAL TABLE ledger_fts USING fts5(text, content='ledger', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER ledger_ai AFTER INSERT ON ledger BEGIN
  INSERT INTO ledger_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TABLE facts(
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  superseded_by INTEGER REFERENCES facts(id)
);
CREATE VIRTUAL TABLE facts_fts USING fts5(subject, body, content='facts', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, subject, body) VALUES (new.id, new.subject, new.body);
END;
CREATE TRIGGER facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, subject, body) VALUES ('delete', old.id, old.subject, old.body);
END;
CREATE TRIGGER facts_au AFTER UPDATE OF subject, body ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, subject, body) VALUES ('delete', old.id, old.subject, old.body);
  INSERT INTO facts_fts(rowid, subject, body) VALUES (new.id, new.subject, new.body);
END;

CREATE TABLE tasks(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE tasks_fts USING fts5(title, goal, plan, result, content='tasks', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, goal, plan, result) VALUES (new.id, new.title, new.goal, new.plan, new.result);
END;
CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, goal, plan, result) VALUES ('delete', old.id, old.title, old.goal, old.plan, old.result);
  INSERT INTO tasks_fts(rowid, title, goal, plan, result) VALUES (new.id, new.title, new.goal, new.plan, new.result);
END;

CREATE TABLE now(
  id INTEGER PRIMARY KEY CHECK (id = 1),
  text TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  peak_tokens INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER
);
`

/** Schema changes after v1, applied in order by `node src/migrate.ts` (never implicitly). */
export const MIGRATIONS: Record<number, string> = {
  2: `
CREATE TABLE agents(
  id TEXT PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id),
  runtime TEXT NOT NULL,
  cwd TEXT NOT NULL,
  repo TEXT,
  branch TEXT,
  brief TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
}

const STOPWORDS = new Set(
  ('a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our ' +
    'so that the their them then there these they this to us was we were what when where which who why will with would you your ' +
    'about any did again all also just should shall some than too very was were been being am').split(' '),
)

/** Free text -> FTS5 MATCH expression: OR of quoted, stopword-free terms. Empty string if nothing searchable. */
export function ftsQuery(text: string): string {
  const terms = new Set<string>()
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue
    terms.add(`"${raw}"`)
  }
  return [...terms].join(' OR ')
}

export function parseRef(ref: string): { kind: 'fact' | 'ledger' | 'task'; id: number } | null {
  const m = /^([FLT])(\d+)$/i.exec(ref.trim())
  if (!m) return null
  const kind = ({ F: 'fact', L: 'ledger', T: 'task' } as const)[m[1].toUpperCase() as 'F' | 'L' | 'T']
  return { kind, id: Number(m[2]) }
}

type Row = Record<string, unknown>

export class Memory {
  readonly db: DatabaseSync
  readonly nowBudgetChars: number
  readonly path: string
  private clock: () => Date

  constructor(path: string, opts: StoreOptions = {}) {
    this.path = path
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
    this.nowBudgetChars = opts.nowBudgetChars ?? 8000
    this.clock = opts.clock ?? (() => new Date())
    this.init()
  }

  private init(): void {
    const hasMeta = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get()
    if (!hasMeta) {
      const tables = this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }
      if (tables.n > 0) throw new Error('memory file is not a Jarvis database (has tables but no meta); refusing to touch it')
      // Fresh file created by Jarvis itself: lay down the schema.
      this.db.exec('BEGIN')
      this.db.exec(SCHEMA)
      for (const v of Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)) this.db.exec(MIGRATIONS[v])
      this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
      this.db.exec('COMMIT')
      return
    }
    const row = this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined
    const v = Number(row?.value ?? 0)
    if (v !== SCHEMA_VERSION) {
      // Never migrate the owner's data implicitly.
      throw new Error(
        v < SCHEMA_VERSION
          ? `memory schema v${v}, code expects v${SCHEMA_VERSION}. Back up and migrate it by hand: node src/migrate.ts ${this.path}`
          : `memory schema v${v} is newer than this code (v${SCHEMA_VERSION}); update Jarvis`,
      )
    }
  }

  close(): void {
    this.db.close()
  }

  private ts(): string {
    return this.clock().toISOString()
  }

  // ---- ledger -------------------------------------------------------------

  append(kind: LedgerKind, text: string, opts: { session?: string | null; meta?: Record<string, unknown> } = {}): LedgerEntry {
    const ts = this.ts()
    text = plainDash(text)
    const meta = opts.meta ? JSON.stringify(opts.meta) : null
    const r = this.db
      .prepare('INSERT INTO ledger(ts, kind, session, text, meta) VALUES (?, ?, ?, ?, ?)')
      .run(ts, kind, opts.session ?? null, text, meta)
    return { id: Number(r.lastInsertRowid), ts, kind, session: opts.session ?? null, text, meta: opts.meta ?? null }
  }

  ledgerGet(id: number): LedgerEntry | null {
    const r = this.db.prepare('SELECT * FROM ledger WHERE id = ?').get(id) as Row | undefined
    return r ? toLedger(r) : null
  }

  /** Newest entries of the given kinds, returned oldest first. */
  ledgerTail(limit: number, kinds?: readonly LedgerKind[]): LedgerEntry[] {
    const where = kinds?.length ? `WHERE kind IN (${kinds.map(() => '?').join(',')})` : ''
    const rows = this.db
      .prepare(`SELECT * FROM ledger ${where} ORDER BY id DESC LIMIT ?`)
      .all(...(kinds ?? []), limit) as Row[]
    return rows.map(toLedger).reverse()
  }

  ledgerSince(afterId: number, kinds?: readonly LedgerKind[]): LedgerEntry[] {
    const kindSql = kinds?.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : ''
    return (this.db.prepare(`SELECT * FROM ledger WHERE id > ? ${kindSql} ORDER BY id`).all(afterId, ...(kinds ?? [])) as Row[]).map(toLedger)
  }

  lastLedgerId(): number {
    return (this.db.prepare('SELECT coalesce(max(id), 0) AS id FROM ledger').get() as { id: number }).id
  }

  // ---- facts --------------------------------------------------------------

  /** Write a fact. `supersedes` marks older facts stale and points them at the new one. */
  factWrite(input: { kind: FactKind; subject: string; body: string; source: string; supersedes?: number[] }, session?: string | null): Fact {
    const ts = this.ts()
    input = { ...input, subject: plainDash(input.subject), body: plainDash(input.body) }
    this.db.exec('BEGIN')
    try {
      const r = this.db
        .prepare('INSERT INTO facts(kind, subject, body, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.kind, input.subject, input.body, input.source, ts, ts)
      const id = Number(r.lastInsertRowid)
      for (const old of input.supersedes ?? []) {
        const u = this.db.prepare('UPDATE facts SET stale = 1, superseded_by = ?, updated_at = ? WHERE id = ? AND id != ?').run(id, ts, old, id)
        if (u.changes === 0) throw new Error(`cannot supersede F${old}: no such fact`)
      }
      const sup = input.supersedes?.length ? ` (supersedes ${input.supersedes.map((n) => `F${n}`).join(', ')})` : ''
      this.append('fact', `F${id} [${input.kind}] ${input.subject}: ${input.body}${sup}`, { session, meta: { fact: id, source: input.source } })
      this.db.exec('COMMIT')
      return this.factGet(id)!
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  factMarkStale(id: number, reason: string, session?: string | null): void {
    const u = this.db.prepare('UPDATE facts SET stale = 1, updated_at = ? WHERE id = ?').run(this.ts(), id)
    if (u.changes === 0) throw new Error(`no such fact F${id}`)
    this.append('fact', `F${id} marked stale: ${reason}`, { session, meta: { fact: id } })
  }

  factGet(id: number): Fact | null {
    const r = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as Row | undefined
    return r ? toFact(r) : null
  }

  factsAll(includeStale = false): Fact[] {
    const where = includeStale ? '' : 'WHERE stale = 0'
    return (this.db.prepare(`SELECT * FROM facts ${where} ORDER BY id`).all() as Row[]).map(toFact)
  }

  // ---- tasks --------------------------------------------------------------

  taskCreate(input: { title: string; goal: string; plan?: string; status?: TaskStatus }, session?: string | null): Task {
    const ts = this.ts()
    input = { ...input, title: plainDash(input.title), goal: plainDash(input.goal), plan: input.plan && plainDash(input.plan) }
    const status = input.status ?? 'open'
    const r = this.db
      .prepare('INSERT INTO tasks(title, goal, plan, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.title, input.goal, input.plan ?? '', status, ts, ts)
    const id = Number(r.lastInsertRowid)
    this.append('task', `T${id} created [${status}] ${input.title}. Goal: ${input.goal}${input.plan ? `. Plan: ${input.plan}` : ''}`, {
      session,
      meta: { task: id, status },
    })
    return this.taskGet(id)!
  }

  taskUpdate(id: number, patch: { title?: string; goal?: string; plan?: string; status?: TaskStatus; result?: string }, session?: string | null): Task {
    const cur = this.taskGet(id)
    if (!cur) throw new Error(`no such task T${id}`)
    patch = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'string' && k !== 'status' ? plainDash(v) : v]))
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Task
    this.db
      .prepare('UPDATE tasks SET title = ?, goal = ?, plan = ?, status = ?, result = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.goal, next.plan, next.status, next.result, this.ts(), id)
    const changes = Object.entries(patch)
      .filter(([k, v]) => v !== undefined && v !== (cur as unknown as Row)[k])
      .map(([k, v]) => `${k}: ${v}`)
    this.append('task', `T${id} updated (${next.title}) ${changes.join('; ') || 'no changes'}`, {
      session,
      meta: { task: id, status: next.status, from: cur.status },
    })
    return this.taskGet(id)!
  }

  taskGet(id: number): Task | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return r ? (r as unknown as Task) : null
  }

  taskList(opts: { open?: boolean; status?: TaskStatus; limit?: number } = {}): Task[] {
    const limit = opts.limit ?? 50
    if (opts.status) return this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY id DESC LIMIT ?').all(opts.status, limit) as unknown as Task[]
    if (opts.open) {
      const ph = CLOSED_STATUSES.map(() => '?').join(',')
      return this.db.prepare(`SELECT * FROM tasks WHERE status NOT IN (${ph}) ORDER BY id DESC LIMIT ?`).all(...CLOSED_STATUSES, limit) as unknown as Task[]
    }
    return this.db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit) as unknown as Task[]
  }

  // ---- now ----------------------------------------------------------------

  nowGet(): Now {
    const r = this.db.prepare('SELECT text, version, updated_at FROM now WHERE id = 1').get() as Now | undefined
    return r ?? { text: '', version: 0, updated_at: '' }
  }

  nowUpdate(text: string, session?: string | null): Now {
    const trimmed = plainDash(text.trim())
    if (trimmed.length > this.nowBudgetChars) {
      throw new Error(`Now is ${trimmed.length} chars, budget is ${this.nowBudgetChars}. Move detail into facts or tasks and keep Now short.`)
    }
    const cur = this.nowGet()
    const ts = this.ts()
    this.db
      .prepare('INSERT INTO now(id, text, version, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, version = excluded.version, updated_at = excluded.updated_at')
      .run(trimmed, cur.version + 1, ts)
    this.append('now', `Now v${cur.version + 1}:\n${trimmed}`, { session, meta: { version: cur.version + 1 } })
    return this.nowGet()
  }

  // ---- sessions -----------------------------------------------------------

  sessionStart(id: string): void {
    this.db.prepare('INSERT INTO sessions(id, started_at) VALUES (?, ?)').run(id, this.ts())
  }

  sessionTurn(id: string, contextTokens: number, contextWindow: number | null): void {
    this.db
      .prepare('UPDATE sessions SET turns = turns + 1, peak_tokens = max(peak_tokens, ?), context_window = coalesce(?, context_window) WHERE id = ?')
      .run(contextTokens, contextWindow, id)
  }

  sessionEnd(id: string, reason: string): void {
    this.db.prepare('UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL').run(this.ts(), reason, id)
  }

  /** The live (not ended) session, if any. */
  sessionCurrent(): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as Row | undefined
    return r ? (r as unknown as Session) : null
  }

  sessions(): Session[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY started_at').all() as unknown as Session[]
  }

  // ---- agents -------------------------------------------------------------

  agentCreate(a: Omit<AgentRow, 'status' | 'created_at' | 'updated_at'>): AgentRow {
    const ts = this.ts()
    this.db
      .prepare('INSERT INTO agents(id, task_id, runtime, cwd, repo, branch, brief, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, a.task_id, a.runtime, a.cwd, a.repo, a.branch, a.brief, 'running', ts, ts)
    return this.agentGet(a.id)!
  }

  agentGet(id: string): AgentRow | null {
    return (this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined) ?? null
  }

  /** Agents not removed, oldest first. */
  agentList(includeRemoved = false): AgentRow[] {
    const where = includeRemoved ? '' : "WHERE status != 'removed'"
    return this.db.prepare(`SELECT * FROM agents ${where} ORDER BY created_at, id`).all() as unknown as AgentRow[]
  }

  agentSetStatus(id: string, status: AgentStatus): void {
    const u = this.db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?').run(status, this.ts(), id)
    if (u.changes === 0) throw new Error(`no such agent ${id}`)
  }

  /** Latest ledger entry about an agent, optionally of one event kind (report, needs, ...). */
  agentLastEvent(id: string, event?: string): LedgerEntry | null {
    const r = this.db
      .prepare(
        `SELECT * FROM ledger WHERE kind = 'agent' AND json_extract(meta, '$.agent') = ? ${event ? "AND json_extract(meta, '$.event') = ?" : ''} ORDER BY id DESC LIMIT 1`,
      )
      .get(...(event ? [id, event] : [id])) as Row | undefined
    return r ? toLedger(r) : null
  }

  // ---- search -------------------------------------------------------------

  searchFacts(query: string, limit = 8, includeStale = false): Hit[] {
    const q = ftsQuery(query)
    if (!q) return []
    const stale = includeStale ? '' : 'AND f.stale = 0'
    const rows = this.db
      .prepare(
        `SELECT f.*, bm25(facts_fts, 3.0, 1.0) AS score FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid
         WHERE facts_fts MATCH ? ${stale} ORDER BY score LIMIT ?`,
      )
      .all(q, limit) as Row[]
    return rows.map((r) => {
      const f = toFact(r)
      return { ref: `F${f.id}`, kind: 'fact', title: `[${f.kind}] ${f.subject}${f.stale ? ' (stale)' : ''}`, text: f.body, date: f.updated_at, score: Number(r.score) }
    })
  }

  searchLedger(query: string, limit = 8, opts: { beforeId?: number; kinds?: readonly LedgerKind[] } = {}): Hit[] {
    const q = ftsQuery(query)
    if (!q) return []
    const args: (string | number)[] = [q]
    let extra = ''
    if (opts.beforeId) {
      extra += ' AND l.id < ?'
      args.push(opts.beforeId)
    }
    if (opts.kinds?.length) {
      extra += ` AND l.kind IN (${opts.kinds.map(() => '?').join(',')})`
      args.push(...opts.kinds)
    }
    args.push(limit)
    const rows = this.db
      .prepare(
        `SELECT l.*, bm25(ledger_fts) AS score, snippet(ledger_fts, 0, '', '', ' ... ', 48) AS snip
         FROM ledger_fts JOIN ledger l ON l.id = ledger_fts.rowid
         WHERE ledger_fts MATCH ? ${extra} ORDER BY score LIMIT ?`,
      )
      .all(...args) as Row[]
    return rows.map((r) => ({ ref: `L${r.id}`, kind: 'ledger', title: String(r.kind), text: String(r.snip), date: String(r.ts), score: Number(r.score) }))
  }

  searchTasks(query: string, limit = 8): Hit[] {
    const q = ftsQuery(query)
    if (!q) return []
    const rows = this.db
      .prepare(
        `SELECT t.*, bm25(tasks_fts, 3.0, 2.0, 1.0, 1.0) AS score FROM tasks_fts JOIN tasks t ON t.id = tasks_fts.rowid
         WHERE tasks_fts MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(q, limit) as Row[]
    return rows.map((r) => ({
      ref: `T${r.id}`,
      kind: 'task',
      title: `[${r.status}] ${r.title}`,
      text: `Goal: ${r.goal}${r.result ? ` Result: ${r.result}` : ''}`,
      date: String(r.updated_at),
      score: Number(r.score),
    }))
  }

  /** Everything matching a query, best first per layer. */
  search(query: string, opts: { scope?: 'all' | 'facts' | 'ledger' | 'tasks'; limit?: number; includeStale?: boolean } = {}): Hit[] {
    const scope = opts.scope ?? 'all'
    const limit = opts.limit ?? 8
    const out: Hit[] = []
    if (scope === 'all' || scope === 'facts') out.push(...this.searchFacts(query, limit, opts.includeStale))
    if (scope === 'all' || scope === 'tasks') out.push(...this.searchTasks(query, limit))
    if (scope === 'all' || scope === 'ledger') out.push(...this.searchLedger(query, limit))
    return out
  }

  /** Resolve an id like F3, L120 or T7. */
  get(ref: string): { ref: string; kind: string; record: unknown } | null {
    const p = parseRef(ref)
    if (!p) return null
    const record = p.kind === 'fact' ? this.factGet(p.id) : p.kind === 'task' ? this.taskGet(p.id) : this.ledgerGet(p.id)
    return record ? { ref: ref.toUpperCase(), kind: p.kind, record } : null
  }
}

function toLedger(r: Row): LedgerEntry {
  return {
    id: Number(r.id),
    ts: String(r.ts),
    kind: r.kind as LedgerKind,
    session: (r.session as string | null) ?? null,
    text: String(r.text),
    meta: r.meta ? (JSON.parse(String(r.meta)) as Record<string, unknown>) : null,
  }
}

function toFact(r: Row): Fact {
  return {
    id: Number(r.id),
    kind: r.kind as FactKind,
    subject: String(r.subject),
    body: String(r.body),
    source: String(r.source),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    stale: Number(r.stale) === 1,
    superseded_by: (r.superseded_by as number | null) ?? null,
  }
}
