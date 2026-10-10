import { assistantEnv } from '../env.ts'
// MCP server exposing Wednesday memory to the captain (stdio).
// Env: MAJORDOMO_DB (memory file), MAJORDOMO_SESSION (captain session id, for the ledger).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { loadConfig } from '../config.ts'
import { apply, check, loadSettings, saveSettings } from '../settings.ts'
import { ENGINES } from '../engines.ts'
import { addSkill, DEFAULT_SKILLS, loadSkills, type Skill } from '../skills/skills.ts'
import { FACT_KINDS, Memory, TASK_STATUSES, type Hit } from '../memory/store.ts'
import { HybridSearch, openSearch } from '../memory/vectors.ts'
import { fmtPage, PAGE_BUDGET, Pages } from '../memory/pages.ts'
import { loadConfig as config, sidecars } from '../config.ts'

export interface AgentApi {
  url: string
  token?: string
}

export function buildServer(
  mem: Memory,
  session: string | null,
  agentApi: AgentApi | null = null,
  skills: Skill[] = DEFAULT_SKILLS,
  skillsDir?: string,
  search: HybridSearch = new HybridSearch(mem, null, null),
  pages: Pages | null = null,
): McpServer {
  // Checked against the live list, so a skill added this turn can be used right away.
  const liveIds = () => (skillsDir ? loadSkills(skillsDir) : skills).map((s) => s.id)
  const checkSkill = (s: string) => {
    if (s !== 'none' && !liveIds().includes(s)) throw new Error(`unknown skill "${s}"; use one of: ${liveIds().join(', ')}, none (or add one with skill_add)`)
  }
  const skillHelp = `Skill this work trains (earns Wednesday EXP when created and when finished): ${skills.map((s) => `${s.id} (${s.covers})`).join('; ')}. Use "none" only for chores that fit no skill.`
  const skillArg = z.string().describe(skillHelp)
  const server = new McpServer({ name: 'wednesday', version: '0.1.0' })

  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })
  const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] })
  const guard =
    <A,>(fn: (args: A) => unknown) =>
    async (args: A) => {
      try {
        return ok(fn(args))
      } catch (e) {
        return fail(e)
      }
    }

  server.registerTool(
    'memory_search',
    {
      description:
        'Search memory by keywords and by meaning: facts (F ids), tasks (T ids) and the ledger of everything said and done (L ids). ' +
        'Use before answering any question about the past. Results carry ids to cite. Empty result means you do not have it.',
      inputSchema: {
        query: z.string().min(1).describe('What you are looking for, in words or a short phrase. Related words also match ("crash" finds "freeze"); if nothing comes back, try other wording.'),
        scope: z.enum(['all', 'facts', 'tasks', 'ledger']).default('all'),
        limit: z.number().int().min(1).max(30).default(8),
        include_stale: z.boolean().default(false).describe('Include facts that were superseded or marked stale.'),
      },
    },
    async ({ query, scope, limit, include_stale }) => {
      try {
        const hits = await search.search(query, { scope, limit, includeStale: include_stale })
        return ok(hits.length ? hits.map(fmtHit).join('\n') : `No matches for "${query}" in ${scope}.`)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'memory_get',
    {
      description: 'Fetch full records by id: F12 (fact), T3 (task), L120 (ledger entry).',
      inputSchema: { ids: z.array(z.string()).min(1).max(20) },
    },
    guard(({ ids }) => ids.map((id) => mem.get(id) ?? { ref: id, error: 'not found' })),
  )

  // fact_write is the name to use: a bare "memory_write" collides with a Claude Code built-in.
  const factWrite = {
      description:
        'Save one atomic, durable fact (about the owner, a person, a project, a preference, or a decision with its reason). ' +
        'One fact per call. If it replaces older facts, pass their ids in supersedes; they are marked stale.',
      inputSchema: {
        kind: z.enum(FACT_KINDS),
        subject: z.string().min(1).max(120).describe('Short handle, e.g. "owner timezone" or "majordomo memory backend".'),
        body: z.string().min(1).max(1500),
        source: z.string().min(1).describe('Where it came from: a ledger id like L42, or "owner".'),
        supersedes: z.array(z.number().int()).optional(),
      },
  }
  const saveFact = guard((a: { kind: (typeof FACT_KINDS)[number]; subject: string; body: string; source: string; supersedes?: number[] }) => {
    const f = mem.factWrite(a, session)
    return `Saved F${f.id}.`
  })
  server.registerTool('fact_write', factWrite, saveFact)
  server.registerTool('memory_write', { ...factWrite, description: `Same as fact_write (older name). ${factWrite.description}` }, saveFact)

  server.registerTool(
    'fact_mark_stale',
    {
      description: 'Mark a fact as no longer true without replacing it.',
      inputSchema: { id: z.number().int(), reason: z.string().min(1) },
    },
    guard(({ id, reason }) => {
      mem.factMarkStale(id, reason, session)
      return `F${id} marked stale.`
    }),
  )

  server.registerTool(
    'now_update',
    {
      description:
        'Replace the Now note: current goals, open tasks (by T id), running agents, what waits on the owner, and the "why" behind ' +
        `current work. Loaded at the start of every session, so a fresh session must be able to continue from it alone. Hard limit ${mem.nowBudgetChars} chars.`,
      inputSchema: { text: z.string().min(1) },
    },
    guard(({ text }) => {
      const n = mem.nowUpdate(text, session)
      return `Now updated (v${n.version}, ${n.text.length}/${mem.nowBudgetChars} chars).`
    }),
  )

  server.registerTool(
    'now_get',
    { description: 'Read the current Now note.', inputSchema: {} },
    guard(() => {
      const n = mem.nowGet()
      return n.version ? `Now v${n.version} (${n.updated_at}):\n${n.text}` : 'Now is empty.'
    }),
  )

  const needPages = () => {
    if (!pages) throw new Error('project pages are not available here')
    return pages
  }

  server.registerTool(
    'page_list',
    { description: 'List the project pages: slug, title, keywords, version and last update.', inputSchema: {} },
    guard(() => {
      const all = needPages().list()
      return all.length
        ? all.map((p) => `${p.slug} v${p.version} (${p.updated_at.slice(0, 10)}) ${p.title} [${p.keywords.join(', ')}] ${p.body.length}/${PAGE_BUDGET} chars`).join('\n')
        : 'No project pages yet. Create one with page_update.'
    }),
  )

  server.registerTool(
    'page_get',
    {
      description: 'Read a project page: the living summary of one project, with the F/T/L ids it rests on. history=true adds its recent versions.',
      inputSchema: { slug: z.string().min(1), history: z.boolean().default(false) },
    },
    guard(({ slug, history }) => {
      const p = needPages().get(slug)
      if (!p) return `No page "${slug}". Pages: ${needPages().list().map((x) => x.slug).join(', ') || '(none)'}`
      const h = history ? `\n\nVersions:\n${needPages().history(p.slug).map((v) => `v${v.version} ${v.ts.slice(0, 16)} ${v.by ?? ''}: ${v.note}`).join('\n')}` : ''
      return `${fmtPage(p)}\nkeywords: ${p.keywords.join(', ')}${h}`
    }),
  )

  server.registerTool(
    'page_update',
    {
      description:
        'Create or rewrite a project page (one per project, e.g. clipcrew, pc-health, wednesday). The body is the whole page: ' +
        'what it is, where it lives, current state, open work by T id, decisions with reasons, what waits on the owner. ' +
        `Cite the ids it rests on, like [F12] [T3] [L120]; every id must exist. Max ${PAGE_BUDGET} chars: summarize, detail stays in facts and the ledger. ` +
        'Read the page first and keep what is still true.',
      inputSchema: {
        slug: z.string().min(2).max(40).describe('Lowercase id, e.g. "clipcrew" or "pc-health".'),
        body: z.string().min(1),
        title: z.string().max(80).optional().describe('Needed when creating the page.'),
        keywords: z.array(z.string().min(2)).max(12).optional().describe('Words that mean a message is about this project (needed when creating). Messages that contain one get the page loaded.'),
        note: z.string().max(200).optional().describe('What changed, in a few words.'),
      },
    },
    guard(({ slug, body, title, keywords, note }) => {
      const p = needPages().update(mem, slug, { body, title, keywords, note }, session)
      return `Page ${p.slug} is v${p.version} (${p.body.length}/${PAGE_BUDGET} chars).`
    }),
  )

  server.registerTool(
    'task_create',
    {
      description: 'Create a task record for a job: title, goal (with the why), the skill it trains, optional plan.',
      inputSchema: {
        title: z.string().min(1).max(160),
        goal: z.string().min(1),
        skill: skillArg,
        plan: z.string().optional(),
        status: z.enum(TASK_STATUSES).default('open'),
      },
    },
    guard(({ skill, ...a }) => {
      checkSkill(skill)
      const t = mem.taskCreate({ ...a, skill: skill === 'none' ? null : skill }, session)
      return `Created T${t.id}${t.skill ? ` (${t.skill})` : ''}.`
    }),
  )

  server.registerTool(
    'skill_add',
    {
      description:
        'Unlock a new skill in the owner\'s skill tree, when real recurring work fits none of the existing skills (e.g. OSINT, Video, Finance). ' +
        'Never add near-duplicates of an existing skill; the tree is capped. Tell the owner you added it.',
      inputSchema: { name: z.string().min(2).max(24), covers: z.string().min(3).max(120), color: z.string().optional() },
    },
    guard(({ name, covers, color }) => {
      if (!skillsDir) throw new Error('skills are not writable here')
      const sk = addSkill(skillsDir, { name, covers, color })
      mem.append('system', `New skill unlocked: ${sk.name}`, { session, meta: { skill_new: { id: sk.id, name: sk.name, color: sk.color } } })
      return `Added skill ${sk.id} (${sk.name}). Tag tasks with it now.`
    }),
  )

  server.registerTool(
    'task_update',
    {
      description:
        'Update a task. Set status done (with result) when finished; delivered work awaiting review is done too. ' +
        'Set waiting_owner only for a decision on the owner-only list, with result saying exactly what the owner must do or decide.',
      inputSchema: {
        id: z.number().int(),
        title: z.string().optional(),
        goal: z.string().optional(),
        plan: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        result: z.string().optional(),
        skill: skillArg.optional(),
      },
    },
    guard(({ id, skill, ...patch }) => {
      if (skill) checkSkill(skill)
      if (patch.status === 'waiting_owner' && !patch.result?.trim())
        throw new Error('waiting_owner needs a result: the exact thing the owner must do or decide, and why you cannot decide it yourself')
      const t = mem.taskUpdate(id, { ...patch, ...(skill ? { skill: skill === 'none' ? undefined : skill } : {}) }, session)
      return `T${t.id} is ${t.status}.`
    }),
  )

  server.registerTool(
    'task_list',
    {
      description: 'List tasks, newest first. Default: open ones only.',
      inputSchema: { open_only: z.boolean().default(true), status: z.enum(TASK_STATUSES).optional(), limit: z.number().int().min(1).max(100).default(30) },
    },
    guard(({ open_only, status, limit }) => {
      const ts = mem.taskList({ open: open_only, status, limit })
      return ts.length ? ts.map((t) => `T${t.id} [${t.status}] ${t.title} - ${t.goal}`).join('\n') : 'No tasks.'
    }),
  )

  server.registerTool(
    'task_get',
    { description: 'Full task record.', inputSchema: { id: z.number().int() } },
    guard(({ id }) => mem.taskGet(id) ?? `No task T${id}.`),
  )

  server.registerTool(
    'log_decision',
    {
      description: 'Record a decision and its reason in the ledger, so it can be cited later. Use for every non-trivial decision.',
      inputSchema: { decision: z.string().min(1), reason: z.string().min(1) },
    },
    guard(({ decision, reason }) => `Logged L${mem.append('decision', `Decision: ${decision}. Reason: ${reason}`, { session }).id}.`),
  )

  registerAgentTools(server, agentApi, skillsDir)
  return server
}

/** Agent tools talk to the web server, which runs the supervisor. */
function registerAgentTools(server: McpServer, api: AgentApi | null, settingsDir?: string) {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    if (!api) return { isError: true, content: [{ type: 'text' as const, text: 'Agents are unavailable: the Wednesday web server is not running (start it with `pnpm start`).' }] }
    try {
      const res = await fetch(api.url + path, {
        method,
        headers: { 'content-type': 'application/json', ...(api.token ? { authorization: `Bearer ${api.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) return { isError: true, content: [{ type: 'text' as const, text: String(data.error ?? `${res.status} ${res.statusText}`) }] }
      return { content: [{ type: 'text' as const, text: typeof data.text === 'string' ? data.text : JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: `Could not reach the Wednesday server: ${(e as Error).message}` }] }
    }
  }

  server.registerTool('captain_engine_set', {
    description: 'Switch the captain engine when the owner requests it. Starts a fresh memory-backed session at the next turn boundary.',
    inputSchema: { engine: z.enum(ENGINES), model: z.string().optional() },
  }, async ({ engine, model }) => {
    if (api) return call('POST', '/api/captain/engine', { engine, model })
    if (!settingsDir) return { isError: true, content: [{ type: 'text' as const, text: 'Captain settings directory is unavailable.' }] }
    const cfg = loadConfig({ dataDir: settingsDir })
    loadSettings(cfg)
    const patch = { engine, engineModel: model ?? '' }
    const errors = check(patch)
    if (Object.keys(errors).length) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errors) }] }
    apply(cfg, patch)
    saveSettings(cfg)
    return { content: [{ type: 'text' as const, text: 'Engine selected; applies at the next turn.' }] }
  })

  server.registerTool(
    'agent_spawn',
    {
      description:
        'Start a worker agent on a job. For code work pass repo: the agent gets a fresh git worktree on its own branch (majordomo/<name> unless you pass branch, e.g. a Jira key). ' +
        'For other work pass cwd. The brief is its whole job: goal, constraints, how to verify, what to report. Link it to a task. ' +
        'You are woken when it ends a turn, needs an answer, or dies; do not poll.',
      inputSchema: {
        name: z.string().describe('Short lowercase name, e.g. "scraper". Never reused.'),
        runtime: z.string().default('claude-code').describe('claude-code (default), codex, pi, kimi, opencode or agy (Gemini by default)'),
        brief: z.string().min(1),
        task_id: z.number().int().optional(),
        repo: z.string().optional(),
        cwd: z.string().optional(),
        branch: z.string().optional(),
        base: z.string().optional().describe('Commit or branch the worktree starts from (default: the repo HEAD).'),
      },
    },
    ({ name, ...rest }) => call('POST', '/api/agents', { id: name, ...rest }),
  )

  server.registerTool(
    'agent_list',
    { description: 'All agents with their live state (working, idle, needs, error, offline), task, branch and folder.', inputSchema: {} },
    () => call('GET', '/api/agents?format=text'),
  )

  server.registerTool(
    'agent_read',
    {
      description: "An agent's live screen (last lines of its terminal) and state. Use when a report is unclear or to check progress without waiting.",
      inputSchema: { name: z.string(), lines: z.number().int().min(10).max(400).default(60) },
    },
    ({ name, lines }) => call('GET', `/api/agents/${encodeURIComponent(name)}/screen?lines=${lines}`),
  )

  server.registerTool(
    'agent_send',
    {
      description: 'Type a message into an agent as its next instruction (follow-up, correction, answer to a question it asked in its report).',
      inputSchema: { name: z.string(), text: z.string().min(1) },
    },
    ({ name, text }) => call('POST', `/api/agents/${encodeURIComponent(name)}/send`, { text }),
  )

  server.registerTool(
    'agent_answer',
    {
      description:
        "Pick an option in the menu on an agent's screen (permission or choice prompt), by its exact label. " +
        'Only answer what the owner already allowed or what is clearly safe and inside the job; otherwise ask the owner first.',
      inputSchema: { name: z.string(), option: z.string() },
    },
    ({ name, option }) => call('POST', `/api/agents/${encodeURIComponent(name)}/answer`, { label: option }),
  )

  server.registerTool(
    'agent_stop',
    {
      description:
        'Stop an agent. remove=true also deletes its worktree (refused if it has uncommitted changes; the branch and commits stay) and takes it off the strip.',
      inputSchema: { name: z.string(), remove: z.boolean().default(false) },
    },
    ({ name, remove }) => call('POST', `/api/agents/${encodeURIComponent(name)}/stop`, { remove }),
  )
}

function fmtHit(h: Hit): string {
  return `${h.ref} (${h.date.slice(0, 10)}) ${h.title}: ${h.text}${h.outdated ? ` [${h.outdated}]` : ''}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = assistantEnv('DB')
  if (!db) {
    console.error('WEDNESDAY_DB (or MAJORDOMO_DB) is required')
    process.exit(2)
  }
  const mem = new Memory(db)
  const url = assistantEnv('URL')
  const search = openSearch(mem, sidecars(db), config().embedModel, (s) => console.error(s))
  // A broken pages sidecar must not take the memory tools down with it.
  let pages: Pages | null = null
  try {
    pages = new Pages(sidecars(db).pages)
  } catch (e) {
    console.error(`project pages unavailable: ${(e as Error).message}`)
  }
  const server = buildServer(mem, assistantEnv('SESSION') || null, url ? { url, token: assistantEnv('TOKEN') || undefined } : null, loadSkills(dirname(db)), dirname(db), search, pages)
  await server.connect(new StdioServerTransport())
}
