import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planApi } from "../src/plan.ts";
import {
  newBoard,
  newItem,
  importIdeas,
  withChildren,
  connectorEnds,
} from "../web/plan-model.ts";
import { boardSchema } from "../web/plan-schema.ts";
describe("plan files API", () => {
  it("creates, updates, reloads and deletes boards without a database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-test-")),
      app = planApi(dir),
      b = newBoard("Research");
    b.items = importIdeas(["One"]);
    const put = () =>
      app.request(`/${b.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
    expect((await put()).status).toBe(200);
    b.name = "Renamed";
    await put();
    expect(await (await planApi(dir).request("/")).json()).toEqual({
      boards: [b],
    });
    expect(readdirSync(join(dir, "plan"))).toEqual([`${b.id}.json`]);
    await app.request(`/${b.id}`, { method: "DELETE" });
    expect(await (await app.request("/")).json()).toEqual({ boards: [] });
  });
  it("rejects traversal, mismatched ids, dangling arrows and invalid dimensions", async () => {
    const app = planApi(mkdtempSync(join(tmpdir(), "plan-test-"))),
      b = newBoard();
    for (const [path, body] of [
      ["not-a-uuid", b],
      [crypto.randomUUID(), b],
      [b.id, { ...b, connectors: [{ id: "c", from: "missing", to: "no" }] }],
      [b.id, { ...b, items: [{ id: "bad", w: -1 }] }],
    ] as const) {
      expect(
        (
          await app.request(`/${path}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }
  });
});
describe("idea importer", () => {
  it("makes movable frames with enclosed cards and retains quotes and timestamps", () => {
    const items = importIdeas(
      JSON.parse(
        readFileSync(
          new URL("./fixtures/plan-ideas.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(items).toHaveLength(5);
    expect(items.filter((i) => i.kind === "group")).toHaveLength(2);
    expect(items.find((i) => i.title === "Capture the spark")?.body).toContain(
      "02:14",
    );
    expect(items.find((i) => i.title === "Capture the spark")?.body).toContain(
      "Start before",
    );
    for (const group of items.filter((i) => i.kind === "group"))
      expect(
        items.some(
          (i) =>
            i.kind === "card" &&
            i.x >= group.x &&
            i.y > group.y &&
            i.y + i.h < group.y + group.h,
        ),
      ).toBe(true);
    expect(boardSchema.safeParse({ ...newBoard(), items }).success).toBe(true);
  });
  it("accepts flat lists and T52 category menus with nested sources", () => {
    expect(importIdeas(["A", "B"])).toHaveLength(2);
    const items = importIdeas({
      question_supercuts: [
        {
          title: "Advice",
          members: [{ answer: { quote: "Try", start: 123, end: 130 } }],
        },
      ],
      stats: { count: 1 },
      limitations: ["candidate"],
    });
    expect(items).toHaveLength(2);
    expect(items[1].body).toContain("123");
    expect(items[1].body).toContain("Try");
  });
  it("rejects empty imports", () =>
    expect(() => importIdeas(null)).toThrow("No ideas"));
});

describe("canvas geometry", () => {
  it("includes enclosed frame children but leaves outside cards alone", () => {
    const group = newItem("group", 0, 0),
      inside = newItem("card", 20, 40),
      outside = newItem("card", 600, 0);
    expect(withChildren([group, inside, outside], [group.id])).toEqual([
      group.id,
      inside.id,
    ]);
  });
  it("places horizontal arrowheads outside card edges", () => {
    const a = newItem("card", 0, 0),
      b = newItem("card", 400, 0);
    const ends = connectorEnds(a, b);
    expect(ends.from.x).toBe(a.w + 8);
    expect(ends.to.x).toBe(b.x - 8);
    expect(ends.from.y).toBe(a.h / 2);
    expect(ends.to.y).toBe(b.h / 2);
  });
});
