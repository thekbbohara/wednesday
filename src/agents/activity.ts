// Copied from agent-hq (server/engine/activity.ts) with its fixtures and tests. Keep the two in sync.
export type Mood = "working" | "idle" | "needs" | "error" | "offline";

// Screen patterns. Agent TUIs change their wording between releases, so these
// are deliberately loose and checked only near the bottom of the screen.
// Questions that name what a menu on screen is asking. They only count when a
// menu is actually there: the same words in an agent's reply are not a prompt.
const MENU_REASONS: Array<[RegExp, string]> = [
  [/\btrust (?:the files|the contents|this folder|this directory)\b|\bone you trust\b/i, "trust prompt"],
  [/\bDo you want to (?:proceed|continue|trust|allow|make|apply|create|run|delete|overwrite|edit)\b/i, "permission prompt"],
  [/\bWould you like to (?:run|make|apply|allow)\b/i, "permission prompt"],
];

// Prompts that stand on their own, without a vertical menu.
const PROMPTS: Array<[RegExp, string]> = [
  [/\bAllow Codex to run\b/i, "permission prompt"],
  [/\bApprove\b.*\?\s*$/im, "approval prompt"],
  [/\((?:y\/n|Y\/n|y\/N)\)\s*\??\s*$|\[(?:y\/n|Y\/n|y\/N)\]\s*\??\s*$/m, "yes/no prompt"],
  [/\bPress Enter to continue\b/i, "waiting for Enter"],
];

const WORKING: RegExp[] = [/\besc to interrupt\b/i, /\bctrl\+c to (?:interrupt|cancel)\b/i, /\bWorking \(\d/];

const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "nu", "tcsh"]);

/** How long a screen change keeps an agent "working" with no other signal. */
export const QUIET_MS = 4000;

export interface Sample {
  human: boolean;
  dead: boolean;
  exitCode: number | null;
  command: string | null;
  screen: string;
  /** ms since the screen last changed (Infinity if never seen). */
  sinceChange: number;
}

export interface Verdict {
  mood: Mood;
  reason: string | null;
}

export function lastLines(screen: string, n: number): string {
  const lines = screen.replace(/\s+$/, "").split("\n");
  return lines.slice(-n).join("\n");
}

/** Reads one agent's state off its pane. Pure, so it is easy to test against real screens. */
export function classify(s: Sample): Verdict {
  if (s.dead) {
    return s.exitCode && s.exitCode !== 0
      ? { mood: "error", reason: `exited with code ${s.exitCode}` }
      : { mood: "offline", reason: "exited" };
  }
  const tail = lastLines(s.screen, 25);
  if (readChoices(s.screen)) {
    const named = MENU_REASONS.find(([re]) => re.test(tail));
    return { mood: "needs", reason: named?.[1] ?? "choice prompt" };
  }
  const prompt = PROMPTS.find(([re]) => re.test(lastLines(s.screen, 6)));
  if (prompt) return { mood: "needs", reason: prompt[1] };

  if (s.human) {
    const busy = s.command && !SHELLS.has(s.command);
    return busy ? { mood: "working", reason: `running ${s.command}` } : { mood: "idle", reason: "at shell prompt" };
  }
  if (WORKING.some((re) => re.test(lastLines(s.screen, 12)))) return { mood: "working", reason: "busy" };
  if (s.sinceChange < QUIET_MS) return { mood: "working", reason: "screen changing" };
  return { mood: "idle", reason: "waiting at prompt" };
}

export interface Choice {
  label: string;
  selected: boolean;
}

const CURSOR = /^\s*[❯›>▶]\s+/;
const NUMBERED = /^\s*(?:[❯›>▶]\s+)?(\d+)[.)]\s+(.+?)\s*$/;
const FOOTER = /\bEnter to (?:confirm|select)\b|\bEsc to (?:cancel|exit)\b/i;

/**
 * Reads the options of a selection menu near the bottom of the screen, so the
 * owner can pick one by name instead of steering it with raw keys. Returns
 * null when the screen holds no menu with exactly one highlighted option.
 */
export function readChoices(screen: string): Choice[] | null {
  const lines = lastLines(screen, 25).split("\n");
  // The menu is the last block of option lines that contains the cursor.
  let cursorAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (CURSOR.test(lines[i]) && lines[i].replace(CURSOR, "").trim()) {
      cursorAt = i;
      break;
    }
  }
  if (cursorAt < 0) return null;

  const indent = (s: string) => s.length - s.trimStart().length;
  const isOption = (s: string) => s.trim() !== "" && !FOOTER.test(s) && !/^[─━-]{6,}/.test(s.trim());
  const cursorIndent = indent(lines[cursorAt]);
  // Unselected options sit indented to where the cursor's text starts (±2).
  const textIndent = cursorIndent + (lines[cursorAt].trimStart().match(/^[❯›>▶]\s+/)?.[0].length ?? 2);
  // A numbered menu is exactly its numbered lines; otherwise go by alignment.
  const cursorNumbered = NUMBERED.test(lines[cursorAt]);
  const fits = (s: string) =>
    !CURSOR.test(s) && (cursorNumbered ? NUMBERED.test(s) : isOption(s) && Math.abs(indent(s) - textIndent) <= 2);

  let start = cursorAt;
  while (start > 0 && fits(lines[start - 1])) start--;
  let end = cursorAt;
  while (end < lines.length - 1 && fits(lines[end + 1])) end++;

  // Without a footer or numbering it is probably a chat prompt, not a menu.
  const block = lines.slice(start, end + 1);
  const numbered = block.every((l) => NUMBERED.test(l));
  const hasFooter = lines.slice(end + 1, end + 4).some((l) => FOOTER.test(l));
  if (block.length < 2 || (!numbered && !hasFooter)) return null;

  return block.map((l, i) => {
    const text = l.replace(CURSOR, "").trim();
    return { label: numbered ? text.replace(/^\d+[.)]\s+/, "") : text, selected: start + i === cursorAt };
  });
}

/**
 * Screen fingerprint for "is the agent doing something". Ignores trailing
 * whitespace and input-box lines: idle agents rotate placeholder hints there
 * ("❯ Try ..."), and the owner typing is not the agent working.
 */
export function fingerprint(screen: string): string {
  let h = 2166136261;
  const text = screen
    .replace(/^\s*[❯›]\s.*$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\s+$/, "");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${text.length}:${h >>> 0}`;
}
