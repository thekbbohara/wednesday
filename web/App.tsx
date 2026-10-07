import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, mergeItems, RUNTIME_COLOR, type Agent, type AgentDetail, type ChatItem, type RefInfo, type SkillView, type Status } from "./api";
import { ExpBar, SkillBody, SkillIcon } from "./Skills";
import { Cited } from "./Cited";
import { Nav, usePage } from "./Nav";
import { Reply } from "./Reply";
import { MemoryPage, PageHead, SettingsPage, SkillsPage, TasksPage } from "./pages";
import { Face, type Mood } from "./Face";
import { buildRows, fullTime, splitCitations, type Row } from "./thread";

const MAJORDOMO_COLOR = "#5cbdf4";
const DRAFT_KEY = "majordomo:draft";
const NEAR_BOTTOM = 80;

type Receipt = Extract<ChatItem, { type: "receipt" }>;

export function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>({
    engine: "claude", name: "Majordomo", thinking: false, agents: [], model: "", lastReplyAt: null, majordomo: { level: 1, exp: 0, floor: 0, next: 300 }, skills: [], waiting: 0 });
  const [page, goPage] = usePage();
  // Bumps on every ledger change, so open pages refresh themselves.
  const [version, setVersion] = useState(0);
  const [unread, setUnread] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [popover, setPopover] = useState<PopoverTarget | null>(null);
  const [unseen, setUnseen] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const loadingOlder = useRef(false);
  const keepOffset = useRef<number | null>(null);
  const firstLoad = useRef(true);

  // Initial page + live events. On reconnect, refetch the latest page to fill any gap.
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    const load = () =>
      api
        .chat()
        .then((p) => {
          setItems((cur) => mergeItems(cur, p.items));
          // Older pages may already be loaded; only the first load decides hasMore.
          if (firstLoad.current) setHasMore(p.hasMore);
          firstLoad.current = false;
          setStatus(p.status);
          setLoaded(true);
        })
        .catch(() => setOnline(false));
    void load();
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("items", (e) => {
        const fresh = JSON.parse((e as MessageEvent).data) as ChatItem[];
        setItems((cur) => mergeItems(cur, fresh));
        setVersion((v) => v + 1);
        if (pageRef.current !== "command" && fresh.some((i) => i.type === "captain")) setUnread(true);
      });
      es.addEventListener("status", (e) => setStatus(JSON.parse((e as MessageEvent).data)));
      es.onopen = () => {
        setOnline((was) => {
          if (!was) void load();
          return true;
        });
      };
      es.onerror = () => {
        if (!closed) setOnline(false);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, []);

  const { rows, trailing } = useMemo(() => buildRows(items), [items]);
  const lastError = [...rows].reverse().find((r) => r.kind === "error" || r.kind === "captain");
  const failed = !status.thinking && lastError?.kind === "error" && lastError.retryable;
  const mood: Mood = !online ? "offline" : status.thinking ? "working" : failed ? "error" : "idle";
  const stateText = !online ? "offline, reconnecting" : status.thinking ? "thinking..." : failed ? "couldn't reply" : "here";

  useEffect(() => {
    document.title = status.thinking ? `${status.name} - thinking` : status.name;
  }, [status.thinking]);

  // Scroll: stick to the bottom when already there; keep position when older items load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
      return;
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [rows, status.thinking, trailing.length]);

  // Keep the newest message in view when the viewport changes (rotation, on-screen keyboard, composer growing).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadOlder = useCallback(async () => {
    const el = scroller.current;
    if (!el || loadingOlder.current || !hasMore || !items.length) return;
    loadingOlder.current = true;
    try {
      const p = await api.chat(items[0].id);
      keepOffset.current = el.scrollHeight - el.scrollTop;
      setItems((cur) => mergeItems(p.items, cur));
      setHasMore(p.hasMore);
    } finally {
      loadingOlder.current = false;
    }
  }, [hasMore, items]);

  const onScroll = () => {
    const el = scroller.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    if (atBottom.current) setUnseen(false);
    if (el.scrollTop < 240) void loadOlder();
    setPopover(null);
  };

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = true;
    setUnseen(false);
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const openRef = (ref: string, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setPopover((p) => (p?.kind === "ref" && p.ref === ref ? null : { kind: "ref", ref, x: r.left, y: r.bottom }));
  };

  const openAgent = (id: string, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // Header faces sit at the right edge, so their popover hangs left from the face's right side.
    setPopover((p) => (p?.kind === "agent" && p.id === id ? null : { kind: "agent", id, x: r.right, y: r.bottom, alignEnd: true }));
  };

  const openSkill = (id: string, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const rail = e.currentTarget.closest(".rail")?.getBoundingClientRect() ?? r;
    const narrow = matchMedia("(max-width: 1099px)").matches;
    // Beside the rail on desktop, under it when the rail is a row.
    setPopover((p) =>
      p?.kind === "skill" && p.id === id ? null : narrow ? { kind: "skill", id, x: r.left, y: rail.bottom } : { kind: "skill", id, x: rail.right + 12, y: r.top - 8 },
    );
  };

  const skillMap = useMemo(() => new Map(status.skills.map((s) => [s.id, s])), [status.skills]);

  const colors = useMemo(() => new Map(status.agents.map((a) => [a.id, RUNTIME_COLOR[a.runtime] ?? OTHER_COLOR])), [status.agents]);

  const liveAgents = useMemo(() => new Map(status.agents.map((a) => [a.id, a])), [status.agents]);
  // The newest "needs" row of each agent that is still waiting gets the answer card.
  const asking = useMemo(() => {
    const newest = new Map<string, number>();
    for (const i of items) if (i.type === "agent" && i.event === "needs") newest.set(i.agent, i.id);
    return new Set([...newest].filter(([agent]) => liveAgents.get(agent)?.state === "needs").map(([, id]) => id));
  }, [items, liveAgents]);

  const closePopover = useCallback(() => setPopover(null), []);

  const send = async (text: string) => {
    atBottom.current = true;
    const { item } = await api.send(text);
    setItems((cur) => mergeItems(cur, [item]));
  };

  return (
    <div className="app">
      <Nav
        page={page}
        onPage={(p) => {
          if (p === "command") setUnread(false);
          goPage(p);
        }}
        waiting={status.waiting}
        unread={unread}
      />
      <div className="main">
        <section className="top">
          <Portrait mood={mood} stateText={stateText} status={status} />
          <Roster agents={status.agents} onAgent={openAgent} />
        </section>

        <section className="page">
          {/* The chat stays mounted on other pages, so its scroll and draft survive. */}
          <div className="page__view" hidden={page !== "command"}>
            <PageHead title="Command Center" />
            <div className="thread" ref={scroller} onScroll={onScroll}>
              <div className="thread__inner">
                {hasMore && <div className="thread__more">Loading earlier messages</div>}
                {loaded && !items.length && <Empty name={status.name} />}
                {rows.map((row) => (
                  <RowView
                    key={row.key}
                    row={row}
                    onRef={openRef}
                    colors={colors}
                    skills={skillMap}
                    onSkills={() => goPage("skills")}
                    majordomoName={status.name}
                    asking={asking}
                    agents={liveAgents}
                  />
                ))}
                {status.thinking && <Pending receipts={trailing} onRef={openRef} name={status.name} />}
                {!status.thinking && trailing.length > 0 && <Receipts receipts={trailing} onRef={openRef} />}
              </div>
            </div>

            <footer className="dock">
              {unseen && (
                <button className="dock__new" onClick={toBottom}>
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                    <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  New messages
                </button>
              )}
              <Composer onSend={send} name={status.name} engine={status.engine} />
            </footer>
          </div>
          {page === "skills" && (
            <div className="page__view">
              <SkillsPage version={version} onSkill={openSkill} onRef={openRef} />
            </div>
          )}
          {page === "tasks" && (
            <div className="page__view">
              <TasksPage version={version} skills={skillMap} onRef={openRef} name={status.name} />
            </div>
          )}
          {page === "memory" && (
            <div className="page__view">
              <MemoryPage version={version} onRef={openRef} name={status.name} />
            </div>
          )}
          {page === "settings" && (
            <div className="page__view">
              <SettingsPage name={status.name} />
            </div>
          )}
        </section>
      </div>

      {popover && (
        <Popover
          x={popover.x}
          y={popover.y}
          alignEnd={popover.kind === "agent"}
          label={popover.kind === "ref" ? popover.ref : popover.id}
          onClose={closePopover}
        >
          {popover.kind === "ref" ? (
            <RefBody target={popover.ref} onRef={openRef} />
          ) : popover.kind === "agent" ? (
            <AgentBody id={popover.id} onRef={openRef} />
          ) : (
            <SkillBody id={popover.id} onRef={openRef} />
          )}
        </Popover>
      )}
    </div>
  );
}

type PopoverTarget =
  | { kind: "ref"; ref: string; x: number; y: number }
  | { kind: "agent"; id: string; x: number; y: number; alignEnd: true }
  | { kind: "skill"; id: string; x: number; y: number };

const OTHER_COLOR = "#8fb3c9";

/** Majordomo's portrait: face, level and EXP, state. */
function Portrait({ mood, stateText, status }: { mood: Mood; stateText: string; status: Status }) {
  const narrow = useNarrow();
  const now = useNow(30_000);
  const j = status.majordomo;
  return (
    <div className="portrait">
      {status.model && <span className="portrait__model">{status.model}</span>}
      <Face id="majordomo" mood={mood} color={MAJORDOMO_COLOR} size={narrow ? 52 : 96} badge={false} />
      <div className="portrait__info">
        <h1 className="portrait__name">
          {status.name} <span className="lv">Lv {j.level}</span>
        </h1>
        <ExpBar p={j} color="var(--blue)" />
        <p className="portrait__exp">
          {j.exp.toLocaleString("en-US")} / {j.next.toLocaleString("en-US")} exp
        </p>
        <div className="portrait__state">
          <span className={`pill pill--${mood}`} aria-live="polite">
            <i />
            {stateText}
          </span>
          {status.lastReplyAt && <span className="portrait__active">Active {ago(status.lastReplyAt, now)}</span>}
        </div>
      </div>
    </div>
  );
}

const TILE = 72;
const GAP = 12;

/** agent-hq's roster: the crew's faces, padded with empty slots to two full rows. */
function Roster({ agents, onAgent }: { agents: Agent[]; onAgent: OnAgent }) {
  const narrow = useNarrow();
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(7);
  const [tip, setTip] = useState<{ id: string; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setColumns(Math.max(1, Math.floor((el.clientWidth + GAP) / (TILE + GAP))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const count = (m: Mood) => agents.filter((a) => a.state === m).length;
  // Phones show the crew as one scrolling row, without empty slots.
  const slots = narrow ? 0 : Math.max(columns * 2, Math.ceil((agents.length + 1) / columns) * columns) - agents.length;
  const show = (id: string) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ id, left: r.left + r.width / 2, top: r.bottom + 6 });
  };
  const live = tip && agents.find((a) => a.id === tip.id);
  return (
    <div className="roster">
      <header className="roster__head">
        <h2 className="roster__title">Crew</h2>
        <p className="roster__stats">
          {agents.length} {agents.length === 1 ? "agent" : "agents"}
          <i>·</i>
          <b className="c-mint">{count("working")}</b> working
          <i>·</i>
          <b className="c-amber">{count("needs")}</b> {count("needs") === 1 ? "needs" : "need"} you
          {count("error") > 0 && (
            <>
              <i>·</i>
              <b className="c-coral">{count("error")}</b> errored
            </>
          )}
        </p>
      </header>
      {narrow && !agents.length ? null : (
      <div className="roster__grid" ref={grid} role="list" aria-label="Agents" onScroll={() => setTip(null)}>
        {agents.map((a) => (
          <button
            key={a.id}
            role="listitem"
            className="tile"
            aria-label={`${a.name}, ${MOOD_LABEL[a.state]}`}
            onClick={(e) => {
              setTip(null);
              onAgent(a.id, e);
            }}
            onMouseEnter={show(a.id)}
            onMouseLeave={() => setTip(null)}
            onFocus={show(a.id)}
            onBlur={() => setTip(null)}
          >
            <Face id={a.id} mood={a.state} color={RUNTIME_COLOR[a.runtime] ?? OTHER_COLOR} size={narrow ? 44 : 60} />
            <span className="tile__name">{a.name}</span>
          </button>
        ))}
        {Array.from({ length: slots }, (_, i) => (
          <button
            key={`slot-${i}`}
            className="tile tile--empty"
            aria-label="Start an agent"
            title="Start an agent"
            onClick={() => dispatchEvent(new CustomEvent("majordomo:prefill", { detail: "Start an agent to " }))}
          >
            <span className="tile__slot" />
          </button>
        ))}
      </div>
      )}
      {live && (
        <span className="tip tip--below" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {live.name} <span className="tip__state">{MOOD_LABEL[live.state]}</span>
        </span>
      )}
    </div>
  );
}

function useNarrow(): boolean {
  const query = "(max-width: 759px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function ago(ts: string, now: number): string {
  const s = Math.max(0, (now - new Date(ts).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

const MOOD_LABEL: Record<Mood, string> = { idle: "idle", working: "working", needs: "needs you", error: "error", offline: "offline" };

function Empty({ name }: { name: string }) {
  return (
    <div className="empty">
      <Face id="majordomo" mood="idle" color={MAJORDOMO_COLOR} size={64} badge={false} />
      <p className="empty__title">Hi, I'm {name}.</p>
      <p className="empty__text">Tell me what you're working on. I'll remember it, keep track of the work, and get it done.</p>
    </div>
  );
}

type OnRef = (ref: string, e: MouseEvent<HTMLElement>) => void;
type OnAgent = (id: string, e: MouseEvent<HTMLElement>) => void;

function RowView({
  row,
  onRef,
  colors,
  skills,
  onSkills,
  majordomoName,
  asking,
  agents,
}: {
  row: Row;
  onRef: OnRef;
  colors: Map<string, string>;
  skills: Map<string, SkillView>;
  onSkills: () => void;
  majordomoName: string;
  asking: Set<number>;
  agents: Map<string, Agent>;
}) {
  switch (row.kind) {
    case "day":
      return (
        <div className="day" role="separator">
          <span>{row.label}</span>
        </div>
      );
    case "owner":
      return (
        <div className={`msg msg--owner${row.first ? " msg--first" : ""}`}>
          <Bubble side="owner" ts={row.item.ts}>
            {row.item.text}
          </Bubble>
        </div>
      );
    case "captain":
      return (
        <div className={`msg msg--captain${row.first ? " msg--first" : ""}`}>
          <div className="msg__face">{row.first && <Face id="majordomo" mood="idle" color={MAJORDOMO_COLOR} size={28} badge={false} />}</div>
          <div className="msg__body">
            <Bubble side="captain" ts={row.item.ts}>
              <Rich text={row.item.text} onRef={onRef} />
            </Bubble>
            {row.receipts.length > 0 && <Receipts receipts={row.receipts} onRef={onRef} />}
          </div>
        </div>
      );
    case "receipts":
      return (
        <div className="msg msg--captain">
          <div className="msg__face" />
          <div className="msg__body">
            <Receipts receipts={row.receipts} onRef={onRef} />
          </div>
        </div>
      );
    case "error":
      return <ErrorNotice item={row.item} retryable={row.retryable} name={majordomoName} />;
    case "levelup": {
      if (row.item.type === "newskill") {
        const n = row.item;
        const sk = skills.get(n.skill) ?? { id: n.skill, name: n.name, color: n.color, covers: "" };
        return (
          <div className="agent-row agent-row--levelup" title={fullTime(n.ts)}>
            <button className="badge badge--mini" aria-label="Open Skills" onClick={onSkills} style={{ background: `color-mix(in srgb, ${sk.color} 16%, transparent)` }}>
              <SkillIcon skill={sk} size={13} />
            </button>
            <span className="agent-row__text">
              New skill unlocked: <b style={{ color: sk.color }}>{n.name}</b>
            </span>
          </div>
        );
      }
      const sk = skills.get(row.item.skill);
      // "jarvis" is the overall-level key in ledgers written before the rename.
      const overall = row.item.skill === "majordomo" || row.item.skill === "jarvis";
      const name = overall ? majordomoName : (sk?.name ?? row.item.skill);
      const color = overall ? "var(--blue-deep)" : (sk?.color ?? OTHER_COLOR);
      return (
        <div className="agent-row agent-row--levelup" title={fullTime(row.item.ts)}>
          {overall || !sk ? (
            <Face id="majordomo" mood="idle" color={MAJORDOMO_COLOR} size={20} badge={false} />
          ) : (
            <button className="badge badge--mini" aria-label="Open Skills" onClick={onSkills} style={{ background: `color-mix(in srgb, ${sk.color} 16%, transparent)` }}>
              <SkillIcon skill={sk} size={13} />
            </button>
          )}
          <span className="agent-row__text">
            <b>{name}</b> reached <b style={{ color }}>level {row.item.level}</b>
          </span>
        </div>
      );
    }
    case "digest":
      return (
        <div className="agent-row agent-row--digest" title={fullTime(row.item.ts)}>
          <Face id="majordomo" mood="offline" color={MAJORDOMO_COLOR} size={20} badge={false} />
          <span className="agent-row__text">{row.item.text}</span>
          <button className="chip" onClick={(e) => onRef(`L${row.item.id}`, e)}>
            L{row.item.id}
          </button>
        </div>
      );
    case "agent": {
      const { item } = row;
      const tone = item.event === "needs" ? " agent-row--needs" : item.event === "error" ? " agent-row--error" : "";
      const mood: Mood = item.event === "needs" ? "needs" : item.event === "error" ? "error" : item.event === "exit" || item.event === "stop" ? "offline" : "idle";
      const line = (
        <div className={`agent-row${tone}`} title={fullTime(item.ts)}>
          <Face id={item.agent} mood={mood} color={colors.get(item.agent) ?? OTHER_COLOR} size={20} badge={false} />
          <span className="agent-row__text">
            <b>{item.agent}</b> {item.text}
          </span>
          <button className="chip" onClick={(e) => onRef(`L${item.id}`, e)}>
            L{item.id}
          </button>
        </div>
      );
      if (!asking.has(item.id)) return line;
      return (
        <>
          {line}
          <div className="answer-card">
            <AnswerBody id={item.agent} prompt={item.prompt ?? null} choices={agents.get(item.agent)?.choices ?? null} />
          </div>
        </>
      );
    }
  }
}

/** A message bubble. Time shows as a tooltip, or under the bubble on tap (touch). */
function Bubble({ side, ts, children }: { side: "owner" | "captain"; ts: string; children: ReactNode }) {
  const [showTime, setShowTime] = useState(false);
  const onClick = () => {
    if (matchMedia("(pointer: coarse)").matches && !getSelection()?.toString()) setShowTime((v) => !v);
  };
  return (
    <>
      <div className={`bubble bubble--${side}`} title={fullTime(ts)} onClick={onClick}>
        {children}
      </div>
      {showTime && <div className={`time time--${side}`}>{fullTime(ts)}</div>}
    </>
  );
}

function ErrorNotice({ item, retryable, name }: { item: Extract<ChatItem, { type: "error" }>; retryable: boolean; name: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="notice" role="alert">
      <span className="notice__text">{name} couldn't reply: {firstLine(item.text)}</span>
      {retryable && (
        <button
          className="notice__retry"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await api.retry(item.id);
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Retry
        </button>
      )}
      {err && <span className="notice__text">{err}</span>}
    </div>
  );
}

function Pending({ receipts, onRef, name }: { receipts: Receipt[]; onRef: OnRef; name: string }) {
  return (
    <div className="msg msg--captain msg--first msg--pending" aria-label={`${name} is thinking`}>
      <div className="msg__face">
        <Face id="majordomo" mood="working" color={MAJORDOMO_COLOR} size={28} badge={false} />
      </div>
      <div className="msg__body">
        <div className="bubble bubble--captain bubble--dots">
          <i />
          <i />
          <i />
        </div>
        {receipts.length > 0 && <Receipts receipts={receipts} onRef={onRef} />}
      </div>
    </div>
  );
}

function Receipts({ receipts, onRef }: { receipts: Receipt[]; onRef: OnRef }) {
  // One line per turn: collapse repeats ("updated T1" twice -> once).
  const seen = new Set<string>();
  const uniq = receipts.filter((r) => {
    const k = `${r.verb} ${r.ref}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <div className="receipts">
      {uniq.map((r, i) => (
        <span key={r.id} className="receipts__item">
          {i > 0 && <span className="receipts__sep" aria-hidden>·</span>}
          {r.verb}{" "}
          <button className="chip" onClick={(e) => onRef(r.ref, e)}>
            {r.ref === "now" ? "Now" : r.ref}
          </button>
        </span>
      ))}
    </div>
  );
}

/** Markdown with citation ids turned into chips. */
function Rich({ text, onRef }: { text: string; onRef: OnRef }) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...rest }) => {
        if (href?.startsWith("#ref:")) {
          const ref = href.slice(5);
          return (
            <button className="chip" onClick={(e) => onRef(ref, e)}>
              {ref}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
            {children}
          </a>
        );
      },
    }),
    [onRef],
  );
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm, remarkCitations]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

function remarkCitations() {
  const walk = (node: MdNode) => {
    if (!node.children || node.type === "link" || node.type === "linkReference") return;
    const next: MdNode[] = [];
    for (const c of node.children) {
      // **F1** or `F1` on its own is a citation too.
      const only = c.type === "inlineCode" ? c.value : c.type === "strong" && c.children?.length === 1 && c.children[0].type === "text" ? c.children[0].value : null;
      if (only && /^[FTL]\d+$/.test(only)) {
        next.push({ type: "link", url: `#ref:${only}`, children: [{ type: "text", value: only }] });
        continue;
      }
      if (c.type !== "text" || !c.value) {
        walk(c);
        next.push(c);
        continue;
      }
      for (const part of splitCitations(c.value)) {
        if (typeof part === "string") next.push({ type: "text", value: part });
        else
          part.forEach((ref, i) => {
            if (i > 0) next.push({ type: "text", value: " " });
            next.push({ type: "link", url: `#ref:${ref}`, children: [{ type: "text", value: ref }] });
          });
      }
    }
    node.children = next;
  };
  return (tree: MdNode) => walk(tree);
}

/** A small panel anchored under what was clicked; closes on Esc or a click outside. */
function Popover({ x, y, alignEnd = false, label, onClose, children }: { x: number; y: number; alignEnd?: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y + 8 });

  // Re-measure whenever the content changes size (it loads after opening).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(12, Math.min(alignEnd ? x - w : x, innerWidth - w - 12));
      const top = y + 8 + h > innerHeight - 12 ? Math.max(12, y - h - 36) : y + 8;
      setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y, alignEnd]);

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    const click = (e: globalThis.MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    addEventListener("keydown", key);
    addEventListener("mousedown", click);
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("mousedown", click);
    };
  }, [onClose]);

  return (
    <div className="popover" ref={box} style={pos} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

function RefBody({ target, onRef }: { target: string; onRef: OnRef }) {
  const [info, setInfo] = useState<RefInfo | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setInfo(null);
    setErr("");
    api.ref(target).then(setInfo, (e) => setErr((e as Error).message));
  }, [target]);

  if (err) return <p className="popover__body">{err === "not found" ? `I have no record ${target}.` : err}</p>;
  if (!info) return <p className="popover__body popover__body--muted">Loading {target}</p>;
  return (
    <>
      <div className="popover__head">
        <span className="chip chip--static">{info.ref}</span>
        <span className="popover__title">{info.title}</span>
        {info.stale && <span className="popover__stale">outdated</span>}
      </div>
      <p className="popover__body">
        <Cited text={info.body} onRef={onRef} />
      </p>
      <p className="popover__meta">
        {info.date ? fullTime(info.date) : ""}
        {info.source ? ` · from ${info.source}` : ""}
      </p>
    </>
  );
}

function AgentBody({ id, onRef }: { id: string; onRef: OnRef }) {
  const [d, setD] = useState<AgentDetail | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  // Live while open: state and reports change under it.
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.agent(id).then(
        (x) => !stop && (setD(x), setErr("")),
        (e) => !stop && setErr((e as Error).message),
      );
    void load();
    const t = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  if (err && !d) return <p className="popover__body">{err}</p>;
  if (!d) return <p className="popover__body popover__body--muted">Loading {id}</p>;
  const a = d.agent;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.attach);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Attach command", a.attach);
    }
  };
  return (
    <div className="agent-pop">
      <div className="popover__head">
        <Face id={a.id} mood={a.mood} color={RUNTIME_COLOR[a.runtime] ?? OTHER_COLOR} size={28} badge={false} />
        <span className="popover__title">{a.id}</span>
        <span className={`pill pill--${a.mood}`}>
          <i />
          {MOOD_LABEL[a.mood]}
        </span>
      </div>
      <dl className="facts">
        {d.task && (
          <>
            <dt>Task</dt>
            <dd>
              <button className="chip" onClick={(e) => onRef(`T${d.task!.id}`, e)}>
                T{d.task.id}
              </button>{" "}
              {d.task.title}
            </dd>
          </>
        )}
        <dt>Runtime</dt>
        <dd>{a.runtime}</dd>
        <dt>{a.branch ? "Branch" : "Folder"}</dt>
        <dd className="mono">{a.branch ?? a.cwd}</dd>
        {a.mood === "needs" && a.reason && (
          <>
            <dt>Waiting on</dt>
            <dd className="c-amber-text">{a.reason}</dd>
          </>
        )}
      </dl>
      {a.mood === "needs" ? (
        <div className="agent-pop__answer">
          <AnswerBody id={a.id} prompt={d.prompt} choices={a.choices?.map((c) => c.label) ?? null} />
        </div>
      ) : a.status === "running" && a.mood !== "error" && a.mood !== "offline" ? (
        <div className="agent-pop__answer">
          <Reply placeholder={`Message ${a.id}`} onSend={(t) => api.reply(a.id, t)} />
        </div>
      ) : null}
      {d.lastReport ? (
        <div className="agent-pop__report">
          <p className="micro">Last report · {fullTime(d.lastReport.ts)}</p>
          <p className="agent-pop__text">{d.lastReport.text}</p>
        </div>
      ) : (
        <p className="agent-pop__none">No report yet.</p>
      )}
      <button className="ghost" onClick={copy}>
        {copied ? "Copied" : "Copy attach command"}
      </button>
    </div>
  );
}

/**
 * Answers an agent's prompt from the web: its question, one button per option
 * of the menu on its screen, or a reply box when the prompt has no menu.
 */
function AnswerBody({ id, prompt, choices }: { id: string; prompt: string | null; choices: string[] | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const pre = useRef<HTMLPreElement>(null);

  // Commands run long; the question is at the bottom.
  useLayoutEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [prompt]);

  const pick = async (label: string) => {
    setBusy(label);
    setErr("");
    try {
      await api.answer(id, label);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="answer">
      {prompt && (
        <pre className="answer__prompt" ref={pre} tabIndex={0} aria-label={`What ${id} is asking`}>
          {prompt}
        </pre>
      )}
      {choices?.length ? (
        <div className="answer__choices" role="group" aria-label={`Answer ${id}`}>
          {choices.map((c) => (
            <button key={c} className="answer__choice" title={c} disabled={busy !== null} onClick={() => void pick(c)}>
              <span>{busy === c ? "Sending" : c}</span>
            </button>
          ))}
        </div>
      ) : (
        <Reply placeholder={`Answer ${id}`} onSend={(t) => api.reply(id, t)} />
      )}
      {err && <p className="answer__err">{err}</p>}
    </div>
  );
}

function Composer({ onSend, name, engine }: { onSend: (text: string) => Promise<void>; name: string; engine: string }) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [text]);

  // An empty roster slot hands the composer a starting phrase.
  useEffect(() => {
    const on = (e: Event) => {
      const start = String((e as CustomEvent<string>).detail ?? "");
      setText((cur) => (cur.trim() ? cur : start));
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    };
    addEventListener("majordomo:prefill", on);
    return () => removeEventListener("majordomo:prefill", on);
  }, []);

  useEffect(() => {
    // Desktop: focus the composer on load. Touch: don't pop the keyboard.
    if (matchMedia("(pointer: fine)").matches) area.current?.focus();
  }, []);

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setErr("");
    // Clear now, so anything typed while sending is kept; put the text back only if it failed.
    setText("");
    try {
      await onSend(t);
    } catch (e) {
      setErr(`Not sent: ${(e as Error).message}`);
      setText((cur) => (cur ? `${t}\n${cur}` : t));
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer-wrap">
      <label className="composer__engine">Engine <select aria-label="Captain engine" value={engine} onChange={(e) => { void onSend(`/engine ${e.target.value}`).catch((e) => setErr(e.message)); }}>
        {['claude', 'codex', 'kimi'].map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      {err && <p className="composer__err">{err}</p>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={area}
          id="message"
          name="message"
          className="composer__input"
          rows={1}
          value={text}
          placeholder={`Message ${name}`}
          aria-label={`Message ${name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="composer__send" type="submit" disabled={!text.trim() || sending} aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function firstLine(s: string): string {
  const l = s.split("\n")[0];
  return l.length > 200 ? `${l.slice(0, 200)}...` : l;
}
