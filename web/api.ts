export type ChatItem =
  | { type: "owner" | "captain"; id: number; ts: string; text: string }
  | { type: "receipt"; id: number; ts: string; verb: string; ref: string }
  | { type: "error"; id: number; ts: string; text: string }
  | { type: "agent"; id: number; ts: string; agent: string; event: string; text: string }
  | { type: "digest"; id: number; ts: string; text: string };

export interface Agent {
  id: string;
  name: string;
  runtime: string;
  state: "idle" | "working" | "needs" | "error" | "offline";
  reason: string | null;
  task: number | null;
}

export interface Status {
  thinking: boolean;
  agents: Agent[];
  model: string;
  lastReplyAt: string | null;
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
