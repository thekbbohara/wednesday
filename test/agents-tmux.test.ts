import { describe, expect, it } from "vitest";
import { parsePanes } from "../src/agents/tmux.ts";

describe("parsePanes", () => {
  it("reads live and dead panes", () => {
    const panes = parsePanes("crew_core_lead|hq|0|hq||hq|claude|hq|42\ncrew_qa_bot|hq|1|hq|3|hq|bash|hq|43\n");
    expect(panes.get("crew_core_lead")).toEqual({ dead: false, exitCode: null, command: "claude", pid: 42 });
    expect(panes.get("crew_qa_bot")).toEqual({ dead: true, exitCode: 3, command: "bash", pid: 43 });
  });

  it("keeps the first pane of a session", () => {
    const panes = parsePanes("s|hq|0|hq||hq|zsh|hq|1\ns|hq|0|hq||hq|vim|hq|2\n");
    expect(panes.get("s")?.command).toBe("zsh");
  });
});
