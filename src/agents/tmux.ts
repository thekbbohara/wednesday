// Copied from agent-hq (server/engine/tmux.ts). Keep the two in sync.
import { execFile, spawn } from "node:child_process";

/**
 * Thin tmux driver on a private socket, so agent-hq never touches the user's
 * own tmux sessions and agents outlive the agent-hq process.
 */
export class Tmux {
  readonly socket: string

  constructor(socket: string) {
    this.socket = socket
  }

  run(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("tmux", ["-L", this.socket, ...args], { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout!.on("data", (d) => (out += d));
      child.stderr!.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(err.trim() || `tmux ${args[0]} exited with ${code}`));
      });
      if (child.stdin) {
        // tmux can exit before reading; the exit code already carries the error.
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      }
    });
  }

  /** Starts a detached session running `command`; keeps the pane after exit so the exit code is readable. */
  async start(name: string, cwd: string, command: string, env: Record<string, string>): Promise<void> {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    await this.run([
      "new-session", "-d", "-s", name, "-c", cwd, "-x", "200", "-y", "50", ...envArgs, command,
      ";", "set-option", "-t", name, "remain-on-exit", "on",
      ";", "set-option", "-t", name, "history-limit", "20000",
    ]);
  }

  async kill(name: string): Promise<void> {
    await this.run(["kill-session", "-t", `=${name}`]).catch((err: Error) => {
      if (!/can't find|no server|not found|error connecting/i.test(err.message)) throw err;
    });
  }

  /** One call for every pane on the socket. */
  async panes(): Promise<Map<string, PaneInfo>> {
    const out = await this.run(["list-panes", "-a", "-F", PANE_FORMAT]).catch((err: Error) => {
      if (/no server|error connecting|No such file/i.test(err.message)) return "";
      throw err;
    });
    return parsePanes(out);
  }

  async capture(name: string, lines: number): Promise<string> {
    return this.run(["capture-pane", "-p", "-t", `=${name}:`, "-S", String(-lines)]);
  }

  /** Pastes text as one bracketed paste, then submits it. */
  async sendText(name: string, text: string): Promise<void> {
    const buffer = `hq-${process.pid}-${Date.now()}`;
    await this.run(["load-buffer", "-b", buffer, "-"], text);
    await this.run(["paste-buffer", "-p", "-d", "-b", buffer, "-t", `=${name}:`]);
    // Agent TUIs treat an Enter that arrives with the paste as part of it.
    await new Promise((r) => setTimeout(r, 200));
    await this.run(["send-keys", "-t", `=${name}:`, "Enter"]);
  }

  async sendKeys(name: string, ...keys: string[]): Promise<void> {
    await this.run(["send-keys", "-t", `=${name}:`, ...keys]);
  }
}

// tmux before 3.4 rewrites tabs in format output as "_", so fields are joined
// with a printable token that cannot appear in a session name.
const SEP = "|hq|";
const PANE_FORMAT = ["#{session_name}", "#{pane_dead}", "#{pane_dead_status}", "#{pane_current_command}", "#{pane_pid}"].join(SEP);

export function parsePanes(out: string): Map<string, PaneInfo> {
  const panes = new Map<string, PaneInfo>();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [session, dead, status, command, pid] = line.split(SEP);
    if (panes.has(session)) continue; // first pane only; agents use one
    panes.set(session, {
      dead: dead === "1",
      exitCode: status ? Number(status) : null,
      command: command || null,
      pid: pid ? Number(pid) : null,
    });
  }
  return panes;
}

export interface PaneInfo {
  dead: boolean;
  exitCode: number | null;
  command: string | null;
  pid: number | null;
}

export function tmuxAvailable(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("tmux", ["-V"], (err, out) => resolve(err ? null : out.trim()));
  });
}
