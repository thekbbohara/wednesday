import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classify, fingerprint, readChoices, type Sample } from "../src/agents/activity.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "../src/agents/fixtures", name), "utf8");

const base: Sample = { human: false, dead: false, exitCode: null, command: "claude", screen: "", sinceChange: Infinity };

describe("classify", () => {
  it("reads real idle agent screens as idle", () => {
    expect(classify({ ...base, screen: fixture("claude-idle.txt") }).mood).toBe("idle");
    expect(classify({ ...base, command: "codex", screen: fixture("codex-idle.txt") }).mood).toBe("idle");
  });

  it("sees a turn in progress", () => {
    const screen = `${fixture("claude-idle.txt")}\n✻ Thinking… (12s · ↑ 1.2k tokens · esc to interrupt)\n`;
    expect(classify({ ...base, screen })).toEqual({ mood: "working", reason: "busy" });
  });

  it("treats a changing screen as work, then settles to idle", () => {
    const screen = fixture("codex-idle.txt");
    expect(classify({ ...base, screen, sinceChange: 900 }).mood).toBe("working");
    expect(classify({ ...base, screen, sinceChange: 60_000 }).mood).toBe("idle");
  });

  it("flags permission prompts as needing the owner", () => {
    const claude = "Bash command\n  rm -rf build\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No, and tell Claude what to do differently (esc)\n";
    expect(classify({ ...base, screen: claude })).toEqual({ mood: "needs", reason: "permission prompt" });
    const codex = "Allow Codex to run `npm test`?\n  › Yes   Always   No\n";
    expect(classify({ ...base, command: "codex", screen: codex }).mood).toBe("needs");
    const trust = "Do you trust the files in this folder?\n ❯ Yes, proceed\n   No, exit\n Enter to confirm · Esc to cancel\n";
    expect(classify({ ...base, screen: trust }).reason).toBe("trust prompt");
  });

  it("does not mistake prompt words in a reply for a prompt", () => {
    const reply = "● Done. I added a check: do you trust this folder? Do you want to proceed with the refactor next?\n\n❯ \n";
    expect(classify({ ...base, screen: reply }).mood).toBe("idle");
    expect(classify({ ...base, screen: "picked: Yes, I trust this folder\n$ " }).mood).toBe("idle");
  });

  it("catches Claude's current folder-trust screen (regression: a brief typed into it chose 'No, exit')", () => {
    expect(classify({ ...base, screen: fixture("claude-trust-prompt.txt") })).toEqual({ mood: "needs", reason: "trust prompt" });
  });

  it("catches any selection menu by its footer", () => {
    const menu = "Pick a model\n❯ 1. Opus\n  2. Sonnet\nEnter to confirm · Esc to cancel\n";
    expect(classify({ ...base, screen: menu })).toEqual({ mood: "needs", reason: "choice prompt" });
  });

  it("ignores prompts that scrolled far up", () => {
    const old = "Overwrite? (y/n)\n" + "done\n".repeat(40);
    expect(classify({ ...base, screen: old }).mood).toBe("idle");
  });

  it("reads exits", () => {
    expect(classify({ ...base, dead: true, exitCode: 0 })).toEqual({ mood: "offline", reason: "exited" });
    expect(classify({ ...base, dead: true, exitCode: 127 })).toEqual({ mood: "error", reason: "exited with code 127" });
  });

  it("judges a human shell seat by its foreground command", () => {
    const shell = { ...base, human: true };
    expect(classify({ ...shell, command: "zsh" }).mood).toBe("idle");
    expect(classify({ ...shell, command: "npm" })).toEqual({ mood: "working", reason: "running npm" });
  });
});

describe("readChoices", () => {
  it("reads Claude's trust menu with the cursor on the default", () => {
    expect(readChoices(fixture("claude-trust-prompt.txt"))).toEqual([
      { label: "No, exit", selected: true },
      { label: "Yes, I trust this folder", selected: false },
    ]);
  });

  it("reads numbered permission menus", () => {
    const screen = [
      "Bash command",
      "  rm -rf build",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and don't ask again for rm commands in /tmp/x",
      "   3. No, and tell Claude what to do differently (esc)",
      "",
    ].join("\n");
    expect(readChoices(screen)).toEqual([
      { label: "Yes", selected: true },
      { label: "Yes, and don't ask again for rm commands in /tmp/x", selected: false },
      { label: "No, and tell Claude what to do differently (esc)", selected: false },
    ]);
  });

  it("finds no menu on an idle prompt", () => {
    expect(readChoices(fixture("claude-idle.txt"))).toBeNull();
    expect(readChoices(fixture("codex-idle.txt"))).toBeNull();
    expect(readChoices("> \n")).toBeNull();
  });
});

describe("fingerprint", () => {
  it("ignores rotating placeholder hints in an idle input box", () => {
    const idle = (hint: string) => `● Done.\n────\n❯ ${hint}\n────\n  ⏵⏵ auto mode on\n`;
    expect(fingerprint(idle('Try "write a test for <filepath>"'))).toBe(fingerprint(idle('Try "how do I log an error?"')));
    expect(fingerprint("● Done.\n")).not.toBe(fingerprint("● Done.\n● Next step\n"));
  });

  it("ignores trailing whitespace but sees real changes", () => {
    expect(fingerprint("a  \nb\n\n\n")).toBe(fingerprint("a\nb"));
    expect(fingerprint("a\nb")).not.toBe(fingerprint("a\nc"));
  });
});
