import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { api, RUNTIME_COLOR, type ExpEvent, type Fact, type Hit, type Settings, type SkillView, type TaskRow } from "./api";
import { Cited } from "./Cited";
import { Face } from "./Face";
import { ExpBar, SkillIcon } from "./Skills";
import { fullTime } from "./thread";

type OnRef = (ref: string, e: MouseEvent<HTMLElement>) => void;

/** Shared head of every page: title on the left, the page's controls on the right. */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page__head">
      <h2 className="page__title">{title}</h2>
      {children && <div className="page__tools">{children}</div>}
    </header>
  );
}

/** Loads on mount and whenever `version` moves (something changed in the ledger). */
function useLoad<T>(load: () => Promise<T>, version: number): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    load().then(
      (d) => live && (setData(d), setError("")),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return { data, error };
}

function Loading({ error }: { error: string }) {
  return <p className={error ? "page__error" : "page__muted"}>{error || "Loading"}</p>;
}

const shortTime = (ts: string) => fullTime(ts).replace(/ \d{4},/, ",");

// ---------- Skills ----------

export function SkillsPage({ version, onSkill, onRef }: { version: number; onSkill: (id: string, e: MouseEvent<HTMLElement>) => void; onRef: OnRef }) {
  const { data, error } = useLoad(api.skills, version);
  return (
    <>
      <PageHead title="Skills">
        {data && (
          <span className="page__hint">
            task created +{data.rules.created} · finished +{data.rules.finished} · by an agent +{data.rules.delegated}
          </span>
        )}
      </PageHead>
      <div className="page__body">
        {!data ? (
          <Loading error={error} />
        ) : (
          <div className="skill-grid">
            {data.skills.map((s) => (
              <SkillCard key={s.id} s={s} onOpen={(e) => onSkill(s.id, e)} onRef={onRef} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SkillCard({ s, onOpen, onRef }: { s: SkillView & { recent: ExpEvent[] }; onOpen: (e: MouseEvent<HTMLElement>) => void; onRef: OnRef }) {
  return (
    <article className="skill-card">
      <button className="skill-card__head" onClick={onOpen} aria-label={`${s.name} details`}>
        <span className="badge badge--card" style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)` }}>
          <SkillIcon skill={s} size={22} />
        </span>
        <span className="skill-card__name">{s.name}</span>
        <span className="lv" style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}>
          Lv {s.level}
        </span>
      </button>
      <ExpBar p={s} color={s.color} />
      <p className="skill-card__nums">
        {s.exp - s.floor} / {s.next - s.floor} exp to Lv {s.level + 1}
      </p>
      {s.covers && <p className="skill-card__covers">{s.covers}</p>}
      {s.recent.length ? (
        <ul className="skill-card__events">
          {s.recent.map((e) => (
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
        <p className="skill-card__none">No exp yet.</p>
      )}
    </article>
  );
}

// ---------- Tasks ----------

const FILTERS = [
  { id: "open", label: "Open", test: (t: TaskRow) => !["done", "cancelled", "waiting_owner"].includes(t.status) },
  { id: "waiting", label: "Waiting on you", test: (t: TaskRow) => t.status === "waiting_owner" },
  { id: "done", label: "Done", test: (t: TaskRow) => t.status === "done" || t.status === "cancelled" },
  { id: "all", label: "All", test: () => true },
] as const;

const STATUS: Record<TaskRow["status"], { label: string; tone: string }> = {
  open: { label: "open", tone: "idle" },
  running: { label: "running", tone: "working" },
  waiting_owner: { label: "waiting on you", tone: "needs" },
  blocked: { label: "blocked", tone: "error" },
  done: { label: "done", tone: "idle" },
  cancelled: { label: "cancelled", tone: "offline" },
};

export function TasksPage({ version, skills, onRef }: { version: number; skills: Map<string, SkillView>; onRef: OnRef }) {
  const { data, error } = useLoad(api.tasks, version);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [open, setOpen] = useState<number | null>(null);
  const tasks = data?.tasks ?? [];
  const shown = tasks.filter(FILTERS.find((f) => f.id === filter)!.test);
  return (
    <>
      <PageHead title="Tasks">
        <div className="seg" role="tablist" aria-label="Filter tasks">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={`seg__btn${filter === f.id ? " is-active" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label} <span className="seg__count">{tasks.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </PageHead>
      <div className="page__body">
        {!data ? (
          <Loading error={error} />
        ) : !shown.length ? (
          <p className="page__muted">{filter === "waiting" ? "Nothing is waiting on you." : "No tasks here yet."}</p>
        ) : (
          <ul className="rows">
            {shown.map((t) => {
              const sk = t.skill ? skills.get(t.skill) : undefined;
              const st = STATUS[t.status];
              const expanded = open === t.id;
              return (
                <li key={t.id} className={`row${expanded ? " is-open" : ""}`}>
                  <button className="row__main" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.id)}>
                    <span className="chip chip--static">T{t.id}</span>
                    <span className={`row__title${t.status === "cancelled" ? " is-struck" : ""}`}>{t.title}</span>
                    {sk && (
                      <span className="badge badge--mini" title={sk.name} style={{ background: `color-mix(in srgb, ${sk.color} 16%, transparent)` }}>
                        <SkillIcon skill={sk} size={13} />
                      </span>
                    )}
                    {t.agent && (
                      <span className="row__agent" title={`${t.agent.name}, ${t.agent.state}`}>
                        <Face id={t.agent.id} mood={t.agent.state} color={RUNTIME_COLOR[t.agent.runtime] ?? "#8fb3c9"} size={20} badge={false} />
                      </span>
                    )}
                    <span className={`pill pill--${st.tone}`}>
                      <i />
                      {st.label}
                    </span>
                    <span className="row__time">{shortTime(t.updated_at)}</span>
                  </button>
                  {expanded && (
                    <div className="row__more">
                      <Field label="Goal" text={t.goal} onRef={onRef} />
                      {t.plan && <Field label="Plan" text={t.plan} onRef={onRef} />}
                      {t.result && <Field label="Result" text={t.result} onRef={onRef} />}
                      <p className="row__meta">
                        {sk ? `${sk.name} · ` : ""}created {shortTime(t.created_at)}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function Field({ label, text, onRef }: { label: string; text: string; onRef: OnRef }) {
  return (
    <div className="field-ro">
      <p className="micro">{label}</p>
      <p className="field-ro__text">
        <Cited text={text} onRef={onRef} />
      </p>
    </div>
  );
}

// ---------- Memory ----------

export function MemoryPage({ version, onRef }: { version: number; onRef: OnRef }) {
  const { data, error } = useLoad(api.memory, version);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [stale, setStale] = useState(false);
  const [openDigest, setOpenDigest] = useState<number | null>(null);

  // Search as you type, a beat after the last key.
  useEffect(() => {
    const query = q.trim();
    if (!query) return setHits(null);
    const t = setTimeout(() => api.search(query).then((r) => setHits(r.hits), () => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, version]);

  const facts = useMemo(() => (data?.facts ?? []).filter((f) => stale || !f.stale), [data, stale]);
  const factById = useMemo(() => new Map((data?.facts ?? []).map((f) => [f.id, f])), [data]);

  return (
    <>
      <PageHead title="Memory">
        <label className="search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path d="M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM15.5 15.5l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input id="memory-search" name="q" type="search" placeholder="Search what Jarvis knows" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </PageHead>
      <div className="page__body">
        {hits ? (
          <SearchResults hits={hits} onRef={onRef} />
        ) : !data ? (
          <Loading error={error} />
        ) : (
          <>
            <section className="mem-section">
              <p className="micro">Now{data.now.version ? ` · v${data.now.version} · ${shortTime(data.now.updated_at)}` : ""}</p>
              <div className="now-block">{data.now.text ? <Cited text={data.now.text} onRef={onRef} /> : <span className="page__muted">Empty: nothing in progress yet.</span>}</div>
            </section>

            <section className="mem-section">
              <div className="mem-section__head">
                <p className="micro">Facts · {facts.length}</p>
                <label className="check">
                  <input type="checkbox" name="show-outdated" checked={stale} onChange={(e) => setStale(e.target.checked)} />
                  show outdated
                </label>
              </div>
              {facts.length ? (
                <ul className="rows">
                  {facts.map((f) => (
                    <FactRow key={f.id} f={f} replacement={f.superseded_by ? factById.get(f.superseded_by) : undefined} onRef={onRef} />
                  ))}
                </ul>
              ) : (
                <p className="page__muted">No facts yet. Jarvis saves them as you talk.</p>
              )}
            </section>

            <section className="mem-section">
              <p className="micro">Daily digests · {data.digests.length}</p>
              {data.digests.length ? (
                <ul className="rows">
                  {data.digests.map((d) => {
                    const [summary, ...rest] = d.text.replace(/^Digest \S+: /, "").split(/\n\nMemory: /);
                    const expanded = openDigest === d.id;
                    return (
                      <li key={d.id} className={`row${expanded ? " is-open" : ""}`}>
                        <button className="row__main" aria-expanded={expanded} onClick={() => setOpenDigest(expanded ? null : d.id)}>
                          <span className="row__date">{d.date}</span>
                          <span className="row__title row__title--soft">{summary.replace(/\s*\[[FTL]\d+(?:\s*,\s*[FTL]\d+)*\]/g, "").split(/(?<=\.)\s/)[0]}</span>
                          <span className="row__time">{rest[0] ? `memory: ${rest[0].replace(/\.$/, "")}` : ""}</span>
                        </button>
                        {expanded && (
                          <div className="row__more">
                            <p className="field-ro__text">
                              <Cited text={summary} onRef={onRef} />
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="page__muted">No digests yet. The nightly sleep writes one per day.</p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function FactRow({ f, replacement, onRef }: { f: Fact; replacement?: Fact; onRef: OnRef }) {
  return (
    <li className={`fact${f.stale ? " is-stale" : ""}`}>
      <span className="chip chip--static">F{f.id}</span>
      <div className="fact__text">
        <p>
          <span className="tag">{f.kind}</span> <b>{f.subject}</b>
        </p>
        <p className="fact__body">{f.body}</p>
        <p className="row__meta">
          {/^L\d+$/.test(f.source) ? (
            <>
              from{" "}
              <button className="chip" onClick={(e) => onRef(f.source, e)}>
                {f.source}
              </button>
            </>
          ) : (
            `from ${f.source}`
          )}
          {" · "}
          {shortTime(f.updated_at)}
          {f.stale && (
            <>
              {" · "}
              {replacement ? (
                <>
                  replaced by{" "}
                  <button className="chip" onClick={(e) => onRef(`F${replacement.id}`, e)}>
                    F{replacement.id}
                  </button>
                </>
              ) : (
                "no longer true"
              )}
            </>
          )}
        </p>
      </div>
    </li>
  );
}

function SearchResults({ hits, onRef }: { hits: Hit[]; onRef: OnRef }) {
  if (!hits.length) return <p className="page__muted">Nothing found. Search uses exact words; try another word for the same thing.</p>;
  const groups = (["fact", "task", "ledger"] as const).map((k) => [k, hits.filter((h) => h.kind === k)] as const).filter(([, hs]) => hs.length);
  const names = { fact: "Facts", task: "Tasks", ledger: "Conversation and events" };
  return (
    <>
      {groups.map(([k, hs]) => (
        <section key={k} className="mem-section">
          <p className="micro">
            {names[k]} · {hs.length}
          </p>
          <ul className="rows">
            {hs.map((h) => (
              <li key={h.ref} className={`fact${h.outdated ? " is-stale" : ""}`}>
                <button className="chip" onClick={(e) => onRef(h.ref, e)}>
                  {h.ref}
                </button>
                <div className="fact__text">
                  <p>
                    <b>{h.title}</b>
                  </p>
                  <p className="fact__body">{h.text}</p>
                  <p className="row__meta">
                    {shortTime(h.date)}
                    {h.outdated && <span className="c-amber-text"> · {h.outdated}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---------- Settings ----------

export function SettingsPage() {
  const { data, error } = useLoad(api.settings, 0);
  const [s, setS] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);

  const save = async (patch: Partial<Settings>) => {
    const key = Object.keys(patch)[0];
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    try {
      const next = await api.saveSettings(patch);
      setS(next);
      setErrors((e) => ({ ...e, [key]: "" }));
      setSaved(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(null), 1600);
    } catch (e) {
      setErrors((cur) => ({ ...cur, ...((e as { errors?: Record<string, string> }).errors ?? { [key]: (e as Error).message }) }));
    }
  };

  if (!data || !s)
    return (
      <>
        <PageHead title="Settings" />
        <div className="page__body">
          <Loading error={error} />
        </div>
      </>
    );

  const models = [...new Set([...data.models, s.model, s.sleepModel])];
  const row = (key: keyof Settings, label: string, hint: string, control: ReactNode) => (
    <div className="setting">
      <div className="setting__text">
        <label className="setting__label" htmlFor={`set-${key}`}>
          {label}
        </label>
        <p className="setting__hint">{hint}</p>
        {errors[key] && <p className="setting__error">{errors[key]}</p>}
      </div>
      <div className="setting__control">
        {control}
        <span className={`setting__saved${saved === key ? " is-on" : ""}`} aria-live="polite">
          {saved === key ? "Saved" : ""}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <PageHead title="Settings" />
      <div className="page__body">
        <div className="settings">
          <p className="micro">Captain</p>
          {row(
            "model",
            "Model",
            "The model Jarvis thinks with. Applies from the next message.",
            <select id="set-model" name="model" className="select" value={s.model} onChange={(e) => save({ model: e.target.value })}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>,
          )}
          {row(
            "web",
            "Web access",
            "Lets Jarvis search the web and read pages to answer you.",
            <Toggle id="set-web" on={s.web} onChange={(web) => save({ web })} label="Web access" />,
          )}

          <p className="micro">Sessions</p>
          {row(
            "rotateAt",
            "Fresh session at",
            "Jarvis starts a fresh session, rebuilt from memory, when the current one fills this share of its context.",
            <select id="set-rotateAt" name="rotateAt" className="select" value={String(s.rotateAt)} onChange={(e) => save({ rotateAt: Number(e.target.value) })}>
              {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7].concat([s.rotateAt]).filter((v, i, a) => a.indexOf(v) === i).sort().map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>,
          )}
          {row(
            "maxTurns",
            "Or after",
            "Turns per session, as a backstop.",
            <NumberField id="set-maxTurns" value={s.maxTurns} suffix="turns" onCommit={(maxTurns) => save({ maxTurns })} />,
          )}

          <p className="micro">Nightly sleep</p>
          {row(
            "sleepAt",
            "Time",
            "When Jarvis tidies memory and writes the day's digest (local time).",
            <div className="inline">
              <Toggle id="set-sleep-on" on={!!s.sleepAt} onChange={(on) => save({ sleepAt: on ? "04:00" : "" })} label="Nightly sleep" />
              {s.sleepAt && (
                <input
                  id="set-sleepAt"
                  name="sleepAt"
                  className="input input--time"
                  type="time"
                  value={s.sleepAt}
                  onChange={(e) => e.target.value && save({ sleepAt: e.target.value })}
                />
              )}
            </div>,
          )}
          {row(
            "sleepModel",
            "Model",
            "A cheap model is enough; every change it proposes is checked before it is applied.",
            <select id="set-sleepModel" name="sleepModel" className="select" value={s.sleepModel} onChange={(e) => save({ sleepModel: e.target.value })}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>,
          )}

          <p className="micro">About</p>
          <dl className="about">
            <dt>Data folder</dt>
            <dd className="mono">{data.about.dataDir}</dd>
            <dt>Sign-in token</dt>
            <dd>{data.about.token ? "on" : "off (fine on localhost; set JARVIS_TOKEN before exposing it)"}</dd>
            <dt>Agent runtimes</dt>
            <dd>
              {data.about.runtimes.length
                ? data.about.runtimes.map((r) => (
                    <span key={r.id} className="about__rt">
                      <b>{r.id}</b> <span className="mono">{r.command}</span>
                    </span>
                  ))
                : "agents are off in this server"}
            </dd>
            <dt>Skills file</dt>
            <dd className="mono">{data.about.skillsFile}</dd>
            <dt>Settings file</dt>
            <dd className="mono">{data.about.settingsFile}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}

function Toggle({ id, on, onChange, label }: { id: string; on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button id={id} role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function NumberField({ id, value, suffix, onCommit }: { id: string; value: number; suffix: string; onCommit: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (v.trim() && n !== value) onCommit(n);
  };
  return (
    <span className="inline">
      <input
        id={id}
        name={id}
        className="input input--num"
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="setting__suffix">{suffix}</span>
    </span>
  );
}
