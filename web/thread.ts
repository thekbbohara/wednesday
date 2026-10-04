import type { ChatItem } from "./api";

type Receipt = Extract<ChatItem, { type: "receipt" }>;
type Message = Extract<ChatItem, { type: "owner" | "captain" }>;
type ErrorItem = Extract<ChatItem, { type: "error" }>;
type AgentItem = Extract<ChatItem, { type: "agent" }>;
type DigestItem = Extract<ChatItem, { type: "digest" }>;
type LevelItem = Extract<ChatItem, { type: "levelup" }>;

export type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "owner"; key: string; item: Message; first: boolean }
  | { kind: "captain"; key: string; item: Message; first: boolean; receipts: Receipt[] }
  | { kind: "receipts"; key: string; receipts: Receipt[] }
  | { kind: "error"; key: string; item: ErrorItem; retryable: boolean }
  | { kind: "agent"; key: string; item: AgentItem }
  | { kind: "digest"; key: string; item: DigestItem }
  | { kind: "levelup"; key: string; item: LevelItem };

export function dayLabel(d: Date, now = new Date()): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 3 Oct, 14:05" */
export function fullTime(ts: string): string {
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hm}`;
}

/**
 * Lay the ledger out as a conversation: day separators, message groups, and
 * memory receipts attached to the captain reply that follows them. Receipts
 * after the last reply are returned as `trailing` so a pending turn can show
 * them live.
 */
export function buildRows(items: ChatItem[], now = new Date()): { rows: Row[]; trailing: Receipt[] } {
  const rows: Row[] = [];
  let receipts: Receipt[] = [];
  let lastDay = "";
  let lastSide: "owner" | "captain" | null = null;
  const lastCaptain = items.reduce((m, i) => (i.type === "captain" ? i.id : m), 0);
  // Only the newest failure, and only if nothing was answered after it, can be retried.
  const lastError = items.reduce((m, i) => (i.type === "error" ? i.id : m), 0);

  const flush = () => {
    if (receipts.length) rows.push({ kind: "receipts", key: `r${receipts[0].id}`, receipts });
    receipts = [];
  };

  for (const item of items) {
    const d = new Date(item.ts);
    const dayKey = d.toDateString();
    if (dayKey !== lastDay && item.type !== "receipt") {
      flush();
      rows.push({ kind: "day", key: `d${item.id}`, label: dayLabel(d, now) });
      lastDay = dayKey;
      lastSide = null;
    }
    switch (item.type) {
      case "receipt":
        receipts.push(item);
        break;
      case "captain":
        rows.push({ kind: "captain", key: `m${item.id}`, item, first: lastSide !== "captain", receipts });
        receipts = [];
        lastSide = "captain";
        break;
      case "owner":
        // Receipts are written during a turn, after the owner message; any
        // left over here belong to no reply (e.g. a failed turn).
        flush();
        rows.push({ kind: "owner", key: `m${item.id}`, item, first: lastSide !== "owner" });
        lastSide = "owner";
        break;
      case "levelup":
        // A level-up lands mid-turn; receipts keep waiting for the reply.
        rows.push({ kind: "levelup", key: `u${item.id}`, item });
        lastSide = null;
        break;
      case "digest":
        flush();
        rows.push({ kind: "digest", key: `g${item.id}`, item });
        lastSide = null;
        break;
      case "agent":
        // Receipts keep accumulating: they belong to the captain reply that follows.
        rows.push({ kind: "agent", key: `a${item.id}`, item });
        lastSide = null;
        break;
      case "error":
        flush();
        rows.push({ kind: "error", key: `e${item.id}`, item, retryable: item.id === lastError && item.id > lastCaptain });
        lastSide = null;
        break;
    }
  }
  return { rows, trailing: receipts };
}

/** Split text into plain runs and citation ids: "see [F3, T1]" -> ["see ", ["F3", "T1"]]. */
export function splitCitations(text: string): (string | string[])[] {
  const out: (string | string[])[] = [];
  const re = /\[((?:[FTL]\d+)(?:\s*,\s*[FTL]\d+)*)\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1].split(/\s*,\s*/));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
