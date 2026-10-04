import { useEffect, useState, type MouseEvent } from "react";
import { api, type Progress, type SkillDetail, type SkillView } from "./api";

/** 24px line icons for the default skills; custom skills get a monogram. */
const ICONS: Record<string, string> = {
  coding: "M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15",
  design: "M12 20.5a8.5 8.5 0 1 1 8.5-8.5c0 2.3-1.9 3.4-3.6 3.4h-1.8a1.8 1.8 0 0 0-1.3 3.1c.6.6.4 2-1.8 2ZM7.8 12.2h.01M10 8.2h.01M14.4 8.2h.01",
  marketing: "M4 10.2v3.6a1 1 0 0 0 1 1h2.4l6.6 4.2V5L7.4 9.2H5a1 1 0 0 0-1 1ZM17.5 8.5a5 5 0 0 1 0 7M7.4 14.8l1.2 4.7",
  hacking: "M3.5 5.5h17v13h-17zM7 10l2.5 2L7 14M12 14.5h4.5",
  research: "M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM15.5 15.5l5 5",
  writing: "M4.5 19.5h5L19.8 9.2a2.5 2.5 0 0 0-3.5-3.5L6 16v3.5ZM14.5 7.5l2 2",
  ops: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13.4l1.6.9-1.8 3.2-1.7-.7a7.5 7.5 0 0 1-2 1.2l-.3 1.8h-3.7l-.3-1.8a7.5 7.5 0 0 1-2-1.2l-1.7.7L3.7 14.3l1.6-.9a7.4 7.4 0 0 1 0-2.8l-1.6-.9 1.8-3.2 1.7.7a7.5 7.5 0 0 1 2-1.2l.3-1.8h3.7l.3 1.8a7.5 7.5 0 0 1 2 1.2l1.7-.7 1.8 3.2-1.6.9a7.4 7.4 0 0 1 0 2.8Z",
};

export function SkillIcon({ skill, size = 20 }: { skill: Pick<SkillView, "id" | "name" | "color">; size?: number }) {
  const d = ICONS[skill.id];
  if (!d)
    return (
      <span className="skill-mono" style={{ color: skill.color, fontSize: size * 0.7 }} aria-hidden>
        {skill.name.slice(0, 1).toUpperCase()}
      </span>
    );
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d={d} fill="none" stroke={skill.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function share(p: Progress): number {
  const span = p.next - p.floor;
  return span > 0 ? Math.min(1, Math.max(0, (p.exp - p.floor) / span)) : 0;
}

export function ExpBar({ p, color }: { p: Progress; color: string }) {
  return (
    <span className="expbar" role="progressbar" aria-valuemin={p.floor} aria-valuemax={p.next} aria-valuenow={p.exp}>
      <span style={{ width: `${share(p) * 100}%`, background: color }} />
    </span>
  );
}

export function SkillBody({ id, onRef }: { id: string; onRef: (ref: string, e: MouseEvent<HTMLElement>) => void }) {
  const [d, setD] = useState<SkillDetail | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.skill(id).then(setD, (e) => setErr((e as Error).message));
  }, [id]);
  if (err) return <p className="popover__body">{err}</p>;
  if (!d) return <p className="popover__body popover__body--muted">Loading</p>;
  const s = d.skill;
  return (
    <div className="skill-pop">
      <div className="popover__head">
        <span className="badge badge--static" style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)` }}>
          <SkillIcon skill={s} />
        </span>
        <span className="popover__title">{s.name}</span>
        <span className="lv">Lv {s.level}</span>
      </div>
      <ExpBar p={s} color={s.color} />
      <p className="skill-pop__nums">
        {s.exp - s.floor} / {s.next - s.floor} exp to level {s.level + 1} · {s.exp} total
      </p>
      {s.covers && <p className="skill-pop__covers">{s.covers}</p>}
      <p className="micro">Earns exp from</p>
      <p className="skill-pop__rules">
        task created +{d.rules.created} · finished +{d.rules.finished} · done by an agent +{d.rules.delegated}
      </p>
      <p className="micro">Recent</p>
      {d.events.length ? (
        <ul className="skill-pop__events">
          {d.events.map((e) => (
            <li key={e.id}>
              <b style={{ color: s.color }}>+{e.amount}</b>
              <span>{e.reason.replace(/^(\w+) T\d+ ?/, "$1 ")}</span>
              {e.ref && (
                <button className="chip" onClick={(ev) => onRef(e.ref!, ev)}>
                  {e.ref}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="skill-pop__none">No exp yet. Tasks tagged {s.name} earn it.</p>
      )}
    </div>
  );
}
