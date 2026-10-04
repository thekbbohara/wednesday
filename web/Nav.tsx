import { useEffect, useState } from "react";

export const PAGES = [
  { id: "command", label: "Command Center", icon: "M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5v-3.5h0a2 2 0 0 1-2-2Z" },
  { id: "skills", label: "Skills", icon: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" },
  { id: "tasks", label: "Tasks", icon: "M9.5 6.5h10M9.5 12h10M9.5 17.5h10M4.5 6.5l1 1 2-2M4.5 12l1 1 2-2M4.5 17.5l1 1 2-2" },
  { id: "memory", label: "Memory", icon: "M12 4.5c-4.4 0-7.5 1.3-7.5 3v9c0 1.7 3.1 3 7.5 3s7.5-1.3 7.5-3v-9c0-1.7-3.1-3-7.5-3ZM4.5 7.5c0 1.7 3.1 3 7.5 3s7.5-1.3 7.5-3M4.5 12c0 1.7 3.1 3 7.5 3s7.5-1.3 7.5-3" },
  {
    id: "settings",
    label: "Settings",
    icon: "M4.5 7h9M17.5 7h2M4.5 12h3M11.5 12h8M4.5 17h7M15.5 17h4M15.5 5v4M9.5 10v4M13.5 15v4",
  },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

const isPage = (s: string): s is PageId => PAGES.some((p) => p.id === s);

/** The page lives in the URL hash (#/tasks), so reloads and back/forward keep it. */
export function usePage(): [PageId, (p: PageId) => void] {
  const read = (): PageId => {
    const h = location.hash.replace(/^#\/?/, "");
    return isPage(h) ? h : "command";
  };
  const [page, setPage] = useState<PageId>(read);
  useEffect(() => {
    const on = () => setPage(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = (p: PageId) => {
    if (p !== page) location.hash = p === "command" ? "" : `/${p}`;
  };
  return [page, go];
}

export function Nav({ page, onPage, waiting, unread }: { page: PageId; onPage: (p: PageId) => void; waiting: number; unread: boolean }) {
  const [tip, setTip] = useState<{ label: string; left: number; top: number } | null>(null);
  return (
    <nav className="nav" aria-label="Pages">
      {PAGES.map((p) => (
        <button
          key={p.id}
          className={`nav__btn${p.id === page ? " is-active" : ""}`}
          aria-label={p.label}
          aria-current={p.id === page ? "page" : undefined}
          onClick={() => {
            setTip(null);
            onPage(p.id);
          }}
          onMouseEnter={(e) => {
            if (!matchMedia("(min-width: 1100px)").matches) return;
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ label: p.label, left: r.right + 18, top: r.top + r.height / 2 - 13 });
          }}
          onMouseLeave={() => setTip(null)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d={p.icon} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {p.id === "tasks" && waiting > 0 && <span className="nav__count">{waiting}</span>}
          {p.id === "command" && unread && <span className="nav__dot" aria-label="new reply" />}
        </button>
      ))}
      {tip && (
        <span className="tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.label}
        </span>
      )}
    </nav>
  );
}
