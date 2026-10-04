// Adapted from agent-hq (server/engine/hooks.ts): the script agent CLIs run
// when they finish a turn. Claude Code passes the hook payload on stdin; Codex
// passes it as the last argument. It forwards the reply to Majordomo and always
// exits 0, so it can never block an agent.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = `// Written by Majordomo. Reports an agent's finished turn back to Majordomo.
const source = process.argv[2];
const url = process.env.MAJORDOMO_URL;
const agent = process.env.MAJORDOMO_AGENT;

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  if (!url || !agent) process.exit(0);
  const raw = source === "codex" ? process.argv[process.argv.length - 1] : await readStdin();
  const payload = JSON.parse(raw);
  const message = source === "codex" ? payload["last-assistant-message"] : payload.last_assistant_message;
  if (typeof message !== "string" || !message.trim()) process.exit(0);
  const headers = { "content-type": "application/json" };
  if (process.env.MAJORDOMO_TOKEN) headers.authorization = "Bearer " + process.env.MAJORDOMO_TOKEN;
  await fetch(url + "/api/hooks/turn", {
    method: "POST",
    headers,
    body: JSON.stringify({ agent, source, message }),
    signal: AbortSignal.timeout(3000),
  });
} catch {
  // Majordomo down or payload unexpected: never get in the agent's way
}
process.exit(0);
`

export function writeHookScript(dataDir: string): string {
  const dir = join(dataDir, 'hooks')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'turn.mjs')
  writeFileSync(path, SCRIPT)
  return path
}

/** POSIX single-quoting for a value placed in a shell command line. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Claude Code workers always get one --settings: the owner's rule that commits
 * and PRs carry no agent co-author line, plus the turn hook when Majordomo can be
 * reached.
 */
export function claudeSettingsArg(script: string | null): string {
  const settings = {
    attribution: { commit: '', pr: '' },
    ...(script ? { hooks: { Stop: [{ hooks: [{ type: 'command', command: `node ${shq(script)} claude` }] }] } } : {}),
  }
  return ` --settings ${shq(JSON.stringify(settings))}`
}

/** Extra CLI arguments that make a runtime report its replies. */
export function turnHookArgs(kind: 'claude' | 'codex' | undefined, script: string): string {
  if (kind === 'claude') {
    const settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: `node ${shq(script)} claude` }] }] } }
    return ` --settings ${shq(JSON.stringify(settings))}`
  }
  if (kind === 'codex') {
    return ` -c ${shq(`notify=${JSON.stringify(['node', script, 'codex'])}`)}`
  }
  return ''
}
