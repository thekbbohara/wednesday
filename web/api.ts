export type ChatItem =
  | { type: "owner" | "captain"; id: number; ts: string; text: string }
  | { type: "receipt"; id: number; ts: string; verb: string; ref: string }
  | { type: "error"; id: number; ts: string; text: string }
  | { type: "agent"; id: number; ts: string; agent: string; event: string; text: string }
  | { type: "digest"; id: number; ts: string; text: string }
  | { type: "levelup"; id: number; ts: string; skill: string; level: number }
  | { type: "newskill"; id: number; ts: string; skill: string; name: string; color: string };

export interface Agent {
  id: string;
  name: string;
  runtime: string;
  state: "idle" | "working" | "needs" | "error" | "offline";
  reason: string | null;
  task: number | null;
}

export interface Progress {
  level: number;
  exp: number;
  floor: number;
  next: number;
}

export interface SkillView extends Progress {
  id: string;
  name: string;
  color: string;
  covers: string;
}

export interface Status {
  name: string;
  thinking: boolean;
  agents: Agent[];
  engine: "claude" | "codex" | "kimi";
  model: string;
  lastReplyAt: string | null;
  majordomo: Progress;
  skills: SkillView[];
  waiting: number;
}

export interface ExpEvent {
  id: number;
  ts: string;
  amount: number;
  reason: string;
  ref: string | null;
}

export interface TaskRow {
  id: number;
  title: string;
  goal: string;
  plan: string;
  status: "open" | "running" | "waiting_owner" | "blocked" | "done" | "cancelled";
  result: string;
  skill: string | null;
  created_at: string;
  updated_at: string;
  agent: Agent | null;
}

export interface Fact {
  id: number;
  kind: string;
  subject: string;
  body: string;
  source: string;
  created_at: string;
  updated_at: string;
  stale: boolean;
  superseded_by: number | null;
}

export interface MemoryView {
  now: { text: string; version: number; updated_at: string };
  facts: Fact[];
  digests: { id: number; ts: string; date: string; text: string }[];
}

export interface Hit {
  ref: string;
  kind: "fact" | "ledger" | "task";
  title: string;
  text: string;
  date: string;
  outdated?: string;
}

export interface Settings {
  engineModel: string;
  engine: "claude" | "codex" | "kimi";
  model: string;
  web: boolean;
  rotateAt: number;
  maxTurns: number;
  sleepAt: string;
  sleepModel: string;
}

export interface SettingsView {
  settings: Settings;
  models: string[];
  about: { dataDir: string; token: boolean; runtimes: { id: string; command: string }[]; skillsFile: string; settingsFile: string };
}

export interface SkillDetail {
  skill: SkillView;
  rules: { created: number; finished: number; delegated: number };
  events: ExpEvent[];
}

export interface AgentDetail {
  agent: {
    id: string;
    runtime: string;
    cwd: string;
    repo: string | null;
    branch: string | null;
    mood: Agent["state"];
    reason: string | null;
    attach: string;
    status: string;
  };
  task: { id: number; title: string; status: string } | null;
  lastReport: { id: number; ts: string; text: string } | null;
}

export interface RefInfo {
  ref: string;
  title: string;
  body: string;
  date: string;
  source?: string;
  stale?: boolean;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  chat: (before?: number) =>
    fetch(`/api/chat?limit=40${before ? `&before=${before}` : ""}`).then((r) =>
      json<{ items: ChatItem[]; hasMore: boolean; status: Status }>(r),
    ),
  send: (text: string) =>
    fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).then((r) =>
      json<{ item: ChatItem }>(r),
    ),
  retry: (id: number) =>
    fetch("/api/retry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
  ref: (ref: string) => fetch(`/api/ref/${encodeURIComponent(ref)}`).then((r) => json<RefInfo>(r)),
  agent: (id: string) => fetch(`/api/agents/${encodeURIComponent(id)}`).then((r) => json<AgentDetail>(r)),
  skill: (id: string) => fetch(`/api/skills/${encodeURIComponent(id)}`).then((r) => json<SkillDetail>(r)),
  skills: () => fetch("/api/skills").then((r) => json<{ skills: (SkillView & { recent: ExpEvent[] })[]; rules: SkillDetail["rules"] }>(r)),
  tasks: () => fetch("/api/tasks").then((r) => json<{ tasks: TaskRow[] }>(r)),
  memory: () => fetch("/api/memory").then((r) => json<MemoryView>(r)),
  search: (q: string) => fetch(`/api/memory?q=${encodeURIComponent(q)}`).then((r) => json<{ query: string; hits: Hit[] }>(r)),
  settings: () => fetch("/api/settings").then((r) => json<SettingsView>(r)),
  saveSettings: async (patch: Partial<Settings>) => {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const body = (await res.json().catch(() => ({}))) as { settings?: Settings; errors?: Record<string, string> };
    if (!res.ok) throw Object.assign(new Error("invalid"), { errors: body.errors ?? {} });
    return body.settings!;
  },
};

/** Merge by id, keeping ledger order. */
export function mergeItems(a: ChatItem[], b: ChatItem[]): ChatItem[] {
  const map = new Map<number, ChatItem>();
  for (const i of a) map.set(i.id, i);
  for (const i of b) map.set(i.id, i);
  return [...map.values()].sort((x, y) => x.id - y.id);
}

export const RUNTIME_COLOR: Record<string, string> = {
  "claude-code": "#5cbdf4",
  codex: "#7c8cf8",
  pi: "#b28cf5",
  opencode: "#4fd1a5",
  kimi: "#f78fb3",
};
