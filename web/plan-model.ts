import type { Board, PlanItem } from "./plan-schema.ts";
export type { Board, PlanItem };
export const newBoard = (name = "Untitled board"): Board => ({
  id: crypto.randomUUID(),
  name,
  items: [],
  connectors: [],
});
export const newItem = (
  kind: PlanItem["kind"],
  x: number,
  y: number,
): PlanItem => ({
  id: crypto.randomUUID(),
  kind,
  x,
  y,
  w: kind === "group" ? 620 : 240,
  h: kind === "group" ? 360 : 210,
  title:
    kind === "group"
      ? "New frame"
      : kind === "card"
        ? "New idea"
        : "Quick thought",
  body: "",
  color: kind === "note" ? "amber" : "plain",
  tags: [],
  status: "idea",
  tasks: [],
});
/** Accept section envelopes and the T52 menu, retaining complete source quotes and timestamps. */
export function importIdeas(value: unknown): PlanItem[] {
  const out: PlanItem[] = [];
  let cursorY = 40;
  const text = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2);
  const card = (v: unknown, x: number, y: number) => {
    const r =
      typeof v === "string" ? { title: v } : (v as Record<string, unknown>);
    if (!r || typeof r !== "object") return;
    const i = newItem("card", x, y);
    i.title = text(r.title ?? r.name ?? r.idea ?? r.label ?? "Imported idea");
    i.body = Object.entries(r)
      .filter(([k]) => !["title", "name", "idea", "label", "tags"].includes(k))
      .map(([k, v]) => `${k}: ${text(v)}`)
      .join("\n\n");
    i.tags = Array.isArray(r.tags) ? r.tags.map(text) : [];
    if (["idea", "planned", "doing", "done"].includes(text(r.status)))
      i.status = text(r.status) as PlanItem["status"];
    out.push(i);
  };
  const section = (title: string, items: unknown[]) => {
    const valid = items.filter(
      (v) => typeof v === "string" || (v && typeof v === "object"),
    );
    if (!valid.length) return;
    const g = newItem("group", 20, cursorY);
    g.title = title;
    g.w = 850;
    g.h = 80 + Math.ceil(valid.length / 3) * 240;
    out.push(g);
    valid.forEach((v, n) =>
      card(v, 40 + (n % 3) * 270, cursorY + 60 + Math.floor(n / 3) * 240),
    );
    cursorY += g.h + 40;
  };
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach((x) => {
        if (
          x &&
          typeof x === "object" &&
          ["items", "ideas", "options"].some((k) =>
            Array.isArray((x as Record<string, unknown>)[k]),
          )
        )
          walk(x);
        else {
          card(x, 40, cursorY);
          cursorY += 240;
        }
      });
      return;
    }
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    if (Array.isArray(r.sections)) {
      r.sections.forEach(walk);
      return;
    }
    const list = r.items ?? r.ideas ?? r.options ?? r.menu;
    if (Array.isArray(list)) {
      section(text(r.title ?? r.name ?? r.section ?? "Imported ideas"), list);
      return;
    }
    const lists = Object.entries(r).filter(
      ([k, v]) =>
        Array.isArray(v) &&
        !["limitations", "tags"].includes(k) &&
        (v as unknown[]).some(
          (x) =>
            x &&
            typeof x === "object" &&
            ("title" in x || "idea" in x || "items" in x),
        ),
    );
    if (lists.length) {
      lists.forEach(([k, v]) =>
        section(k.replaceAll("_", " "), v as unknown[]),
      );
      return;
    }
    card(r, 40, cursorY);
    cursorY += 240;
  };
  walk(value);
  if (!out.length) throw new Error("No ideas found");
  return out;
}

/** Anchor arrows just outside the rectangle so the arrowhead stays visible. */
export function connectorEnds(a: PlanItem, b: PlanItem) {
  const ax = a.x + a.w / 2,
    ay = a.y + a.h / 2,
    bx = b.x + b.w / 2,
    by = b.y + b.h / 2,
    dx = bx - ax,
    dy = by - ay;
  const edge = (
    i: PlanItem,
    cx: number,
    cy: number,
    vx: number,
    vy: number,
  ) => {
    const t = Math.min(
      vx ? i.w / 2 / Math.abs(vx) : Infinity,
      vy ? i.h / 2 / Math.abs(vy) : Infinity,
    );
    const length = Math.hypot(vx, vy) || 1;
    return {
      x: cx + vx * (Number.isFinite(t) ? t : 0) + (vx / length) * 8,
      y: cy + vy * (Number.isFinite(t) ? t : 0) + (vy / length) * 8,
    };
  };
  return { from: edge(a, ax, ay, dx, dy), to: edge(b, bx, by, -dx, -dy) };
}

/** A frame owns fully enclosed items, including nested frames. */
export function withChildren(items: PlanItem[], selected: string[]): string[] {
  const ids = new Set(selected);
  for (const group of items.filter(
    (i) => ids.has(i.id) && i.kind === "group",
  )) {
    for (const child of items)
      if (
        child.x >= group.x &&
        child.y >= group.y &&
        child.x + child.w <= group.x + group.w &&
        child.y + child.h <= group.y + group.h
      )
        ids.add(child.id);
  }
  return [...ids];
}
