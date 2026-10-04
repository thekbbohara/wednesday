import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, mergeItems, RUNTIME_COLOR, type Agent, type ChatItem, type RefInfo, type Status } from "./api";
import { Face, type Mood } from "./Face";
import { buildRows, fullTime, splitCitations, type Row } from "./thread";

const JARVIS_COLOR = "#5cbdf4";
const DRAFT_KEY = "jarvis:draft";
const NEAR_BOTTOM = 80;

type Receipt = Extract<ChatItem, { type: "receipt" }>;

export function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>({ thinking: false, agents: [] });
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [popover, setPopover] = useState<{ ref: string; x: number; y: number } | null>(null);
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
      es.addEventListener("items", (e) => setItems((cur) => mergeItems(cur, JSON.parse((e as MessageEvent).data))));
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
    document.title = status.thinking ? "Jarvis - thinking" : "Jarvis";
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
    setPopover((p) => (p?.ref === ref ? null : { ref, x: r.left, y: r.bottom }));
  };

  const closePopover = useCallback(() => setPopover(null), []);

  const send = async (text: string) => {
    atBottom.current = true;
    const { item } = await api.send(text);
    setItems((cur) => mergeItems(cur, [item]));
  };

  return (
    <div className="app">
      <header className="strip">
        <div className="strip__inner">
          <div className="strip__me">
            <Face id="jarvis" mood={mood} color={JARVIS_COLOR} size={36} badge={false} />
            <div className="strip__who">
              <span className="strip__name">Jarvis</span>
              <span className={`strip__state strip__state--${mood}`} aria-live="polite">
                {stateText}
              </span>
            </div>
          </div>
          <Agents agents={status.agents} />
        </div>
      </header>

      <main className="thread" ref={scroller} onScroll={onScroll}>
        <div className="thread__inner">
          {hasMore && <div className="thread__more">Loading earlier messages</div>}
          {loaded && !items.length && <Empty />}
          {rows.map((row) => (
            <RowView key={row.key} row={row} onRef={openRef} />
          ))}
          {status.thinking && <Pending receipts={trailing} onRef={openRef} />}
          {!status.thinking && trailing.length > 0 && <Receipts receipts={trailing} onRef={openRef} />}
        </div>
      </main>

      <footer className="dock">
        {unseen && (
          <button className="dock__new" onClick={toBottom}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New messages
          </button>
        )}
        <Composer onSend={send} />
      </footer>

      {popover && <RefPopover target={popover.ref} x={popover.x} y={popover.y} onClose={closePopover} />}
    </div>
  );
}

function Agents({ agents }: { agents: Agent[] }) {
  // The tooltip lives outside the scrolling list, which would clip it.
  const [tip, setTip] = useState<{ agent: Agent; right: number } | null>(null);
  if (!agents.length) return null;
  const show = (a: Agent) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ agent: a, right: Math.max(8, innerWidth - r.right) });
  };
  const live = tip && agents.find((a) => a.id === tip.agent.id);
  return (
    <>
      <ul className="strip__agents" aria-label="Agents" onScroll={() => setTip(null)}>
        {agents.map((a) => (
          <li
            key={a.id}
            className="strip__agent"
            tabIndex={0}
            aria-label={`${a.name}, ${MOOD_LABEL[a.state]}`}
            onMouseEnter={show(a)}
            onMouseLeave={() => setTip(null)}
            onFocus={show(a)}
            onBlur={() => setTip(null)}
          >
            <Face id={a.id} mood={a.state} color={RUNTIME_COLOR[a.runtime] ?? "#8fb3c9"} size={28} />
          </li>
        ))}
      </ul>
      {live && (
        <span className="tip" role="tooltip" style={{ right: tip.right }}>
          {live.name} <span className="tip__state">{MOOD_LABEL[live.state]}</span>
        </span>
      )}
    </>
  );
}

const MOOD_LABEL: Record<Mood, string> = { idle: "idle", working: "working", needs: "needs you", error: "error", offline: "offline" };

function Empty() {
  return (
    <div className="empty">
      <Face id="jarvis" mood="idle" color={JARVIS_COLOR} size={64} badge={false} />
      <p className="empty__title">Hi, I'm Jarvis.</p>
      <p className="empty__text">Tell me what you're working on. I'll remember it, keep track of the work, and get it done.</p>
    </div>
  );
}

type OnRef = (ref: string, e: MouseEvent<HTMLElement>) => void;

function RowView({ row, onRef }: { row: Row; onRef: OnRef }) {
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
          <div className="msg__face">{row.first && <Face id="jarvis" mood="idle" color={JARVIS_COLOR} size={28} badge={false} />}</div>
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
      return <ErrorNotice item={row.item} retryable={row.retryable} />;
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

function ErrorNotice({ item, retryable }: { item: Extract<ChatItem, { type: "error" }>; retryable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="notice" role="alert">
      <span className="notice__text">Jarvis couldn't reply: {firstLine(item.text)}</span>
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

function Pending({ receipts, onRef }: { receipts: Receipt[]; onRef: OnRef }) {
  return (
    <div className="msg msg--captain msg--first msg--pending" aria-label="Jarvis is thinking">
      <div className="msg__face">
        <Face id="jarvis" mood="working" color={JARVIS_COLOR} size={28} badge={false} />
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

function RefPopover({ target, x, y, onClose }: { target: string; x: number; y: number; onClose: () => void }) {
  const [info, setInfo] = useState<RefInfo | null>(null);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y + 8 });

  useEffect(() => {
    setInfo(null);
    setErr("");
    api.ref(target).then(setInfo, (e) => setErr((e as Error).message));
  }, [target]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(12, Math.min(x, innerWidth - w - 12));
    const top = y + 8 + h > innerHeight - 12 ? Math.max(12, y - h - 36) : y + 8;
    setPos({ left, top });
  }, [x, y, info, err]);

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
    <div className="popover" ref={box} style={pos} role="dialog" aria-label={target}>
      {err ? (
        <p className="popover__body">{err === "not found" ? `I have no record ${target}.` : err}</p>
      ) : !info ? (
        <p className="popover__body popover__body--muted">Loading {target}</p>
      ) : (
        <>
          <div className="popover__head">
            <span className="chip chip--static">{info.ref}</span>
            <span className="popover__title">{info.title}</span>
            {info.stale && <span className="popover__stale">outdated</span>}
          </div>
          <p className="popover__body">{info.body}</p>
          <p className="popover__meta">
            {info.date ? fullTime(info.date) : ""}
            {info.source ? ` · from ${info.source}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

function Composer({ onSend }: { onSend: (text: string) => Promise<void> }) {
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
          placeholder="Message Jarvis"
          aria-label="Message Jarvis"
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
