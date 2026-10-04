import { describe, expect, it } from "vitest";
import type { ChatItem } from "./api";
import { buildRows, dayLabel, splitCitations } from "./thread";

const at = (id: number, day = "2026-10-03T10:00:00") => new Date(`${day}`).toISOString().replace(/\.\d+Z$/, `.${String(id).padStart(3, "0")}Z`);
const owner = (id: number, ts = at(id)): ChatItem => ({ type: "owner", id, ts, text: `o${id}` });
const captain = (id: number, ts = at(id)): ChatItem => ({ type: "captain", id, ts, text: `c${id}` });
const receipt = (id: number, ref: string): ChatItem => ({ type: "receipt", id, ts: at(id), verb: "saved", ref });
const error = (id: number): ChatItem => ({ type: "error", id, ts: at(id), text: "boom" });
const now = new Date("2026-10-03T12:00:00");

describe("buildRows", () => {
  it("attaches receipts to the reply that follows them and groups sides", () => {
    const { rows, trailing } = buildRows([owner(1), owner(2), receipt(3, "F1"), captain(4), captain(5)], now);
    expect(rows.map((r) => r.kind)).toEqual(["day", "owner", "owner", "captain", "captain"]);
    expect(rows.map((r) => ("first" in r ? r.first : null))).toEqual([null, true, false, true, false]);
    const reply = rows[3];
    expect(reply.kind === "captain" && reply.receipts.map((r) => r.ref)).toEqual(["F1"]);
    expect(trailing).toEqual([]);
  });

  it("returns receipts after the last reply as trailing (pending turn)", () => {
    const { trailing } = buildRows([owner(1), receipt(2, "T1")], now);
    expect(trailing.map((r) => r.ref)).toEqual(["T1"]);
  });

  it("only the newest unanswered failure is retryable", () => {
    const { rows } = buildRows([owner(1), error(2), error(3), owner(4), captain(5), owner(6), error(7)], now);
    expect(rows.filter((r) => r.kind === "error").map((r) => r.kind === "error" && r.retryable)).toEqual([false, false, true]);
  });

  it("separates days", () => {
    const { rows } = buildRows([owner(1, "2026-10-02T20:00:00.000Z"), captain(2, "2026-10-03T09:00:00.000Z")], new Date("2026-10-03T12:00:00.000Z"));
    expect(rows.filter((r) => r.kind === "day").length).toBe(2);
  });
});

describe("agent rows", () => {
  it("sit between messages, break captain groups, and leave receipts for the next reply", () => {
    const agent: ChatItem = { type: "agent", id: 3, ts: at(3), agent: "scraper", event: "report", text: "finished a turn" };
    const { rows } = buildRows([captain(1), receipt(2, "T1"), agent, captain(4)], now);
    expect(rows.map((r) => r.kind)).toEqual(["day", "captain", "agent", "captain"]);
    const last = rows[3];
    expect(last.kind === "captain" && last.first).toBe(true);
    expect(last.kind === "captain" && last.receipts.map((r) => r.ref)).toEqual(["T1"]);
  });
});

describe("dayLabel", () => {
  it("names recent days and dates older ones", () => {
    expect(dayLabel(new Date("2026-10-03T08:00:00"), now)).toBe("Today");
    expect(dayLabel(new Date("2026-10-02T23:00:00"), now)).toBe("Yesterday");
    expect(dayLabel(new Date("2026-09-28T10:00:00"), now)).toBe("Mon 28 Sep");
    expect(dayLabel(new Date("2025-09-28T10:00:00"), now)).toBe("Sun 28 Sep 2025");
  });
});

describe("splitCitations", () => {
  it("splits single and grouped ids", () => {
    expect(splitCitations("see [F3] and [T1, L42].")).toEqual(["see ", ["F3"], " and ", ["T1", "L42"], "."]);
    expect(splitCitations("[x] [F] plain")).toEqual(["[x] [F] plain"]);
  });
});
