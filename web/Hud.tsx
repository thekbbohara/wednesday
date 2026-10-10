import { useEffect, useState, type MouseEvent } from "react";
import type { CreditAccount } from "../src/credits-types";
import type { SystemStats } from "../src/system-types";
import { RUNTIME_COLOR, type Agent, type Status } from "./api";
import { Face, type Mood } from "./Face";
import { ExpBar } from "./Skills";
import { useScramble } from "./useScramble";

const REFRESH_MS = 60_000;
const MAJORDOMO_COLOR = "#5cbdf4";
const OTHER_COLOR = "#8fb3c9";
/** Faces shown in the crew stack; the rest live in the roster sheet. */
const STACK = 4;

/** engine id -> substring of the provider runtime name, for matching accounts. */
const ENGINE_RUNTIME: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  kimi: "kimi",
  agy: "antigravity",
};

function matchesEngine(account: CreditAccount, engine: string): boolean {
  const needle = ENGINE_RUNTIME[engine] ?? engine;
  return account.runtime.toLowerCase().includes(needle);
}

const minRemaining = (a: CreditAccount) =>
  a.allowances.reduce<number | undefined>((m, w) => (w.remainingPercent !== undefined ? Math.min(m ?? 100, w.remainingPercent) : m), undefined);

/** Busy first, the agent that needs the owner leading. */
const RANK: Record<Agent["state"], number> = { needs: 0, error: 1, working: 2, idle: 3, offline: 4 };
export const isBusy = (a: Agent) => a.state === "working" || a.state === "needs" || a.state === "error" || (a.task !== null && a.state !== "offline");

/**
 * The shell's status bar: Wednesday, the crew, and live usage, in one 72px card.
 * Replaces the portrait / roster / usage band; the full roster opens as a sheet.
 */
export function Hud({
  mood,
  stateText,
  status,
  rosterOpen,
  onRoster,
  onAgent,
  onUsage,
}: {
  mood: Mood;
  stateText: string;
  status: Status;
  rosterOpen: boolean;
  onRoster: () => void;
  onAgent: (id: string, e: MouseEvent<HTMLElement>) => void;
  onUsage: () => void;
}) {
  return (
    <header className="hud">
      <HudMe mood={mood} stateText={stateText} status={status} />
      <span className="hud__sep" aria-hidden />
      <HudCrew agents={status.agents} rosterOpen={rosterOpen} onRoster={onRoster} onAgent={onAgent} />
      <span className="hud__sep hud__sep--usage" aria-hidden />
      <HudUsage engine={status.engine} onOpen={onUsage} />
    </header>
  );
}

function HudMe({ mood, stateText, status }: { mood: Mood; stateText: string; status: Status }) {
  const j = status.majordomo;
  const exp = useScramble(j.exp.toLocaleString("en-US"));
  const next = useScramble(j.next.toLocaleString("en-US"));
  return (
    <div className="hud__me">
      <Face id="majordomo" mood={mood} color={MAJORDOMO_COLOR} size={44} badge={false} />
      <div className="hud__id">
        <h1 className="hud__name">
          {status.name} <span className="lv">Lv {j.level}</span>
          <span className={`hud__state hud__state--${mood}`} aria-live="polite" title={status.lastReplyAt ? `Last reply ${new Date(status.lastReplyAt).toLocaleString()}` : undefined}>
            <i />
            {stateText}
            {status.model && <span className="hud__model"> · {status.model}</span>}
          </span>
        </h1>
        <span className="hud__exp">
          <ExpBar p={j} color="var(--blue)" />
          <small>
            {exp} / {next}
          </small>
        </span>
      </div>
    </div>
  );
}

function HudCrew({ agents, rosterOpen, onRoster, onAgent }: { agents: Agent[]; rosterOpen: boolean; onRoster: () => void; onAgent: (id: string, e: MouseEvent<HTMLElement>) => void }) {
  const busy = agents.filter(isBusy).sort((a, b) => RANK[a.state] - RANK[b.state]);
  const shown = (busy.length ? busy : agents).slice(0, busy.length ? STACK : 3);
  const count = (s: Agent["state"]) => agents.filter((a) => a.state === s).length;
  const needs = agents.filter((a) => a.state === "needs");
  const errored = count("error");
  const nAgents = useScramble(agents.length);
  const nWorking = useScramble(count("working"));
  const nNeeds = useScramble(needs.length);
  const title = !agents.length
    ? "No crew yet"
    : needs.length === 1
      ? `${needs[0].name} needs you`
      : needs.length > 1
        ? `${needs.length} agents need you`
        : busy.length
          ? `${busy.length} ${busy.length === 1 ? "agent" : "agents"} at work`
          : "Crew is resting";
  return (
    <div className="hud__crew">
      {shown.length > 0 && (
        <span className={`hud__stack${busy.length ? "" : " hud__stack--rest"}`}>
          {shown.map((a) => (
            <button key={a.id} className="hud__face" onClick={(e) => onAgent(a.id, e)} aria-label={`${a.name}, ${a.state === "needs" ? "needs you" : a.state}`} title={a.name}>
              <Face id={a.id} mood={a.state} color={RUNTIME_COLOR[a.runtime] ?? OTHER_COLOR} size={34} badge={busy.length > 0} />
            </button>
          ))}
        </span>
      )}
      <button className="hud__crew-label" onClick={onRoster} aria-expanded={rosterOpen} aria-haspopup="dialog">
        <b>{title}</b>
        <span>
          {nAgents} {agents.length === 1 ? "agent" : "agents"}
          <i>·</i>
          <em className="c-mint">{nWorking}</em> working
          <i>·</i>
          <em className="c-amber">{nNeeds}</em> {needs.length === 1 ? "needs" : "need"} you
          {errored > 0 && (
            <>
              <i>·</i>
              <em className="c-coral">{errored}</em> errored
            </>
          )}
        </span>
      </button>
      <button className={`hud__roster${rosterOpen ? " is-on" : ""}`} onClick={onRoster} aria-expanded={rosterOpen} aria-haspopup="dialog">
        <span className="hud__roster-text">Roster</span>
        <span className="hud__roster-n">{agents.length}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
          <path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function Pct({ value }: { value: number }) {
  const v = useScramble(Number(value.toFixed(0)));
  return <b>{v}%</b>;
}

function Meter({ label, value, title, tone, kind }: { label: string; value: number | undefined; title?: string; tone?: "soft"; kind?: "sys" }) {
  const low = value !== undefined && value <= 10 && kind !== "sys";
  return (
    <span className={`meter${kind === "sys" ? " meter--sys" : ""}`} title={title}>
      <span className="meter__top">
        <span className="meter__label">{label}</span>
        {value !== undefined ? <Pct value={value} /> : <b className="meter__none">-</b>}
      </span>
      <span className={`meter__bar${low ? " is-low" : ""}${tone === "soft" ? " is-soft" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? 0} aria-label={label}>
        <i style={{ width: `${Math.min(100, value ?? 0)}%` }} />
      </span>
    </span>
  );
}

/**
 * Credits of the engine in use, the next account available for a switch, and
 * this PC's load. Refreshes every minute while the tab is visible; opens /usages.
 */
function HudUsage({ engine, onOpen }: { engine: string; onOpen: () => void }) {
  const [accounts, setAccounts] = useState<CreditAccount[] | null>(null);
  const [sys, setSys] = useState<SystemStats | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const [c, s] = await Promise.all([
          fetch("/api/credits").then((r) => (r.ok ? r.json() : null)) as Promise<{ accounts: CreditAccount[] } | null>,
          fetch("/api/system").then((r) => (r.ok ? r.json() : null)) as Promise<SystemStats | null>,
        ]);
        if (!live) return;
        if (c) setAccounts(c.accounts);
        if (s) setSys(s);
      } catch {
        /* keep the last reading; this is ambient status */
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const available = (accounts ?? []).filter((a) => a.status === "available");
  const current = available.find((a) => matchesEngine(a, engine)) ?? available[0];
  const next = available.filter((a) => a.id !== current?.id).sort((a, b) => (minRemaining(b) ?? -1) - (minRemaining(a) ?? -1))[0];
  const cpu = sys ? Math.round(sys.cpu.percent) : undefined;
  const ram = sys ? Math.round((sys.memory.used / sys.memory.total) * 100) : undefined;
  const checking = accounts === null;

  return (
    <button className="hud__usage" onClick={onOpen} aria-label="Runtime usage and credits - opens the full page">
      <Meter label={current?.runtime ?? engine} value={current ? minRemaining(current) : undefined} title={checking ? "checking" : current ? `In use: ${current.runtime}, remaining allowance` : "no allowance reported"} />
      <Meter label={checking ? "Next" : `Next · ${next?.runtime ?? "none"}`} value={next ? minRemaining(next) : undefined} title={checking ? "checking" : next ? `Next up: ${next.runtime}, remaining allowance` : "nothing available"} />
      <Meter label="CPU" value={cpu} kind="sys" tone="soft" title={sys ? `This PC · ${sys.hostname}` : "reading"} />
      <Meter label="RAM" value={ram} kind="sys" tone="soft" title={sys ? `This PC · ${sys.hostname}` : "reading"} />
    </button>
  );
}
