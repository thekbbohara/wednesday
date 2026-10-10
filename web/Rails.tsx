import { useEffect, useState } from "react";
import { api, RUNTIME_COLOR, type Agent, type MemoryView, type SkillView, type TaskRow } from "./api";
import { Face } from "./Face";
import { isBusy } from "./Hud";
import { useScramble } from "./useScramble";

const REFRESH_MS = 60_000;
const OTHER_COLOR = "#8fb3c9";

export function useRailData(version: number): { tasks: TaskRow[]; memory: MemoryView | null } {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [memory, setMemory] = useState<MemoryView | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const [t, m] = await Promise.all([api.tasks(), api.memory()]);
        if (!live) return;
        setTasks(t.tasks);
        setMemory(m);
      } catch {
        /* rails are ambient; keep the last reading */
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [version]);
  return { tasks, memory };
}

export const isWaiting = (t: TaskRow) => t.status === "waiting_owner" || t.status === "blocked";

const prefill = (text: string) => dispatchEvent(new CustomEvent("majordomo:prefill", { detail: text }));

function age(ts: string): string {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

function RailHead({ label, count, tone, onClose }: { label: string; count?: number; tone?: "amber" | "blue"; onClose?: () => void }) {
  return (
    <span className="rail-col__head">
      <h3 className={`micro${tone ? ` micro--${tone}` : ""}`}>
        {label}
        {count !== undefined && <> · {count}</>}
      </h3>
      {onClose && (
        <button className="rail-col__close" onClick={onClose} aria-label={`Hide ${label}`}>
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** Right rail: what the crew is doing right now. */
export function WorkRail({ agents, tasks, onClose }: { agents: Agent[]; tasks: TaskRow[]; onClose?: () => void }) {
  const busy = agents.filter(isBusy);
  const idle = agents.length - busy.length;
  const titles = new Map(tasks.map((t) => [t.id, t]));
  const resting = agents.find((a) => a.state === "idle" || a.state === "offline") ?? agents[0];
  return (
    <aside className="rail-col rail-col--right" aria-label="Crew live">
      <RailHead label="Crew live" count={busy.length} tone="blue" onClose={onClose} />
      {busy.length === 0 ? (
        <div className="rail-col__idle">
          {resting && <Face id={resting.id} mood={resting.state} color={RUNTIME_COLOR[resting.runtime] ?? OTHER_COLOR} size={36} />}
          <p className="rail-col__idle-title">The crew is resting</p>
          <p className="rail-col__idle-text">{idle > 0 ? `All ${idle} ${idle === 1 ? "agent is" : "agents are"} idle.` : "No agents yet."}</p>
          <button className="rail-col__start" onClick={() => prefill("Start an agent to ")}>
            Start an agent
          </button>
        </div>
      ) : (
        <ul className="work">
          {busy.map((a) => {
            const task = a.task ? titles.get(a.task) : undefined;
            return (
              <li key={a.id} className={`work__item work__item--${a.state}`}>
                <span className="work__head">
                  <Face id={a.id} mood={a.state} color={RUNTIME_COLOR[a.runtime] ?? OTHER_COLOR} size={24} badge={false} />
                  <b>{a.name}</b>
                  <span className={`pill pill--${a.state === "idle" ? "offline" : a.state}`}>
                    <i />
                    {a.state === "needs" ? "needs you" : a.state}
                  </span>
                </span>
                {task && (
                  <span className="work__task">
                    <span className="chip chip--static">T{task.id}</span>
                    <span className="work__title">{task.title}</span>
                  </span>
                )}
                {a.reason && <span className="work__reason">{a.reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {busy.length > 0 && idle > 0 && <p className="rail-col__foot">{idle} resting</p>}
    </aside>
  );
}

type Entry = { kind: "task"; task: TaskRow } | { kind: "group"; name: string; tasks: TaskRow[] };

/** Project of a "ClipCrew: ..." or "ClipCrew premium edit: ..." title: the first word before a colon. */
const projectOf = (t: TaskRow): string | null => {
  const i = t.title.indexOf(":");
  return i > 0 && i <= 40 ? t.title.slice(0, i).trim().split(/\s+/)[0] : null;
};

/** Tasks of the same project collapse into one group row. */
function groupWaiting(waiting: TaskRow[]): Entry[] {
  const newest = [...waiting].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const prefix = projectOf;
  const counts = new Map<string, number>();
  for (const t of newest) {
    const p = prefix(t);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const entries: Entry[] = [];
  const groups = new Map<string, Extract<Entry, { kind: "group" }>>();
  for (const t of newest) {
    const p = prefix(t);
    if (p && (counts.get(p) ?? 0) > 1) {
      const g = groups.get(p);
      if (g) g.tasks.push(t);
      else {
        const fresh = { kind: "group" as const, name: p, tasks: [t] };
        groups.set(p, fresh);
        entries.push(fresh);
      }
    } else entries.push({ kind: "task", task: t });
  }
  return entries;
}

function SkillDot({ id, skills }: { id: string | null; skills: Map<string, SkillView> }) {
  const sk = id ? skills.get(id) : undefined;
  return <i className="needs__dot" style={{ background: sk?.color ?? OTHER_COLOR }} />;
}

function NeedsRow({ t, skills, onOpen, inGroup }: { t: TaskRow; skills: Map<string, SkillView>; onOpen: () => void; inGroup?: string }) {
  // Inside a group the project name is redundant: "ClipCrew premium edit: real BGM" reads "premium edit: real BGM".
  const rest = inGroup && t.title.startsWith(inGroup) ? t.title.slice(inGroup.length).replace(/^:?\s*/, "") : "";
  const title = rest ? rest[0].toUpperCase() + rest.slice(1) : t.title;
  const sk = t.skill ? skills.get(t.skill) : undefined;
  return (
    <li className={`needs__row${inGroup ? " needs__row--child" : ""}`}>
      <button className="needs__main" onClick={onOpen} title={`${t.title} - open in Tasks`}>
        <span className="chip chip--static">T{t.id}</span>
        <span className="needs__title">{title}</span>
        <span className="needs__meta">
          <SkillDot id={t.skill} skills={skills} />
          {sk?.name ?? t.skill ?? "task"}
          <i>·</i>
          {t.status === "blocked" ? "blocked" : age(t.updated_at)}
        </span>
      </button>
      <button className="needs__reply" onClick={() => prefill(`About T${t.id} (${t.title}): `)} aria-label={`Reply about T${t.id}`}>
        Reply
      </button>
    </li>
  );
}

function NeedsGroup({ g, skills, onOpen }: { g: Extract<Entry, { kind: "group" }>; skills: Map<string, SkillView>; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const kinds = new Set(g.tasks.map((t) => t.skill ?? "task"));
  const oldest = g.tasks.reduce((m, t) => (t.updated_at < m ? t.updated_at : m), g.tasks[0].updated_at);
  return (
    <li className={`needs__group${open ? " is-open" : ""}`}>
      <button className="needs__main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="chip chip--static">×{g.tasks.length}</span>
        <span className="needs__title">
          {g.name} · {g.tasks.length} waiting
        </span>
        <span className="needs__meta">
          <SkillDot id={g.tasks[0].skill} skills={skills} />
          {kinds.size === 1 ? (skills.get([...kinds][0])?.name ?? [...kinds][0]) : `${kinds.size} skills`}
          <i>·</i>
          oldest {age(oldest)}
        </span>
        <svg className="needs__caret" viewBox="0 0 24 24" width="12" height="12" aria-hidden>
          <path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="needs__children">
          {g.tasks.map((t) => (
            <NeedsRow key={t.id} t={t} skills={skills} onOpen={onOpen} inGroup={g.name} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Left rail: what waits on the owner, then the Now note. */
export function NeedsRail({
  memory,
  tasks,
  skills,
  onTasks,
  onMemory,
  onClose,
}: {
  memory: MemoryView | null;
  tasks: TaskRow[];
  skills: Map<string, SkillView>;
  onTasks: () => void;
  onMemory: () => void;
  onClose?: () => void;
}) {
  const waiting = tasks.filter(isWaiting);
  const openCount = useScramble(tasks.filter((t) => t.status === "open" || t.status === "running").length);
  return (
    <aside className="rail-col rail-col--left" aria-label="Needs you">
      <RailHead label="Needs you" count={waiting.length} tone="amber" onClose={onClose} />
      {waiting.length > 0 ? (
        <ul className="needs">
          {groupWaiting(waiting).map((e) =>
            e.kind === "group" ? <NeedsGroup key={`g-${e.name}`} g={e} skills={skills} onOpen={onTasks} /> : <NeedsRow key={e.task.id} t={e.task} skills={skills} onOpen={onTasks} />,
          )}
        </ul>
      ) : (
        <p className="rail-col__calm">
          <i aria-hidden />
          Nothing needs you right now
        </p>
      )}
      <div className="rail-col__end">
        {memory?.now.text && (
          <button className="rail-col__now" onClick={onMemory} title="Open the full note in Memory">
            <span className="micro">Now</span>
            <span className="rail-col__now-text">{memory.now.text}</span>
          </button>
        )}
        <button className="rail-col__link" onClick={onTasks}>
          {openCount} open tasks
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
            <path d="M9 5.5 15.5 12 9 18.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

/**
 * Narrow screens (<1400): one line over the thread instead of side rails.
 * It names what waits and who works; clicking it drops the panels down.
 */
export function RailsBanner({ waiting, agents, open, onToggle }: { waiting: TaskRow[]; agents: Agent[]; open: boolean; onToggle: () => void }) {
  const busy = agents.filter(isBusy);
  if (!waiting.length && !busy.length) return null;
  const names = [...waiting].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 2);
  return (
    <button className={`rails-banner${waiting.length ? "" : " rails-banner--crew"}${open ? " is-open" : ""}`} onClick={onToggle} aria-expanded={open}>
      {waiting.length > 0 && (
        <>
          <i className="rails-banner__dot" aria-hidden />
          <b>{waiting.length} need you</b>
          <span className="rails-banner__list">
            {names.map((t) => `T${t.id} ${t.title}`).join(", ")}
            {waiting.length > names.length && `, +${waiting.length - names.length}`}
          </span>
        </>
      )}
      {busy.length > 0 && (
        <span className="rails-banner__crew">
          {busy.slice(0, 3).map((a) => (
            <Face key={a.id} id={a.id} mood={a.state} color={RUNTIME_COLOR[a.runtime] ?? OTHER_COLOR} size={18} badge={false} />
          ))}
          {busy.length} busy
        </span>
      )}
      <span className="rails-banner__open">
        {open ? "Close" : "Open"}
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden>
          <path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
