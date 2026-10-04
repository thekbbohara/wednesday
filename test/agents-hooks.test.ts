import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeSettingsArg, turnHookArgs, writeHookScript } from "../src/agents/hooks.ts";

const dir = mkdtempSync(join(tmpdir(), "majordomo-hooks-"));
const script = writeHookScript(dir);
const received: Array<{ auth: string | undefined; body: Record<string, string> }> = [];
let server: Server;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(data) });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// Async on purpose: a sync spawn would block the in-process server it calls.
function hook(args: string[], environment: NodeJS.ProcessEnv, input?: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn("node", [script, ...args], { env: environment, stdio: ["pipe", "ignore", "ignore"] });
    child.on("close", resolve);
    child.stdin.end(input ?? "");
  });
}

const env = () => ({ ...process.env, MAJORDOMO_URL: url, MAJORDOMO_AGENT: "scraper", MAJORDOMO_TOKEN: "s3cret" });

describe("turn hook script", () => {
  it("forwards a Claude Stop payload from stdin", async () => {
    expect(await hook(["claude"], env(), JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "Hi! Ready." }))).toBe(0);
    expect(received.at(-1)).toEqual({ auth: "Bearer s3cret", body: { agent: "scraper", source: "claude", message: "Hi! Ready." } });
  });

  it("forwards a Codex notify payload from argv", async () => {
    const payload = JSON.stringify({ type: "agent-turn-complete", "last-assistant-message": "Done: tests pass." });
    expect(await hook(["codex", payload], env())).toBe(0);
    expect(received.at(-1)?.body.message).toBe("Done: tests pass.");
  });

  it("never fails the agent: bad payload or Majordomo down still exits 0", async () => {
    expect(await hook(["claude"], env(), "not json")).toBe(0);
    const down = { ...env(), MAJORDOMO_URL: "http://127.0.0.1:9" };
    expect(await hook(["claude"], down, JSON.stringify({ last_assistant_message: "x" }))).toBe(0);
  });
});

describe("turnHookArgs", () => {
  // What the agent CLI actually receives after the shell parses the command line.
  const argv = (args: string) => execFileSync("sh", ["-c", `for a in ${args}; do printf '%s\\n' "$a"; done`]).toString().trim().split("\n");

  it("gives Claude one --settings JSON with a Stop hook", () => {
    const [flag, json] = argv(turnHookArgs("claude", "/data/it's here/turn.mjs"));
    expect(flag).toBe("--settings");
    const settings = JSON.parse(json);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(`node '/data/it'\\''s here/turn.mjs' claude`);
  });

  it("gives Codex a notify override", () => {
    const [flag, value] = argv(turnHookArgs("codex", "/data/hooks/turn.mjs"));
    expect(flag).toBe("-c");
    expect(value).toBe('notify=["node","/data/hooks/turn.mjs","codex"]');
  });

  it("always turns off Claude's commit co-author line, with or without the hook", () => {
    for (const script of ["/data/hooks/turn.mjs", null]) {
      const [flag, json] = argv(claudeSettingsArg(script));
      expect(flag).toBe("--settings");
      const settings = JSON.parse(json);
      expect(settings.attribution).toEqual({ commit: "", pr: "" });
      expect(!!settings.hooks).toBe(script !== null);
    }
  });

  it("adds nothing for runtimes without a hook", () => {
    expect(turnHookArgs(undefined, "/x")).toBe("");
  });
});
