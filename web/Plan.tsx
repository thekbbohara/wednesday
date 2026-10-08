import { boardSchema } from "./plan-schema";
import { useEffect, useRef, useState } from "react";
import { api, type TaskRow } from "./api";
import { PageHead } from "./pages";
import {
  connectorEnds,
  withChildren,
  importIdeas,
  newBoard,
  newItem,
  type Board,
  type PlanItem,
} from "./plan-model";
import "./plan.css";
async function request(path = "", method = "GET", body?: Board) {
  const r = await fetch(`/api/plan${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Save failed");
  return data;
}
export function PlanPage({
  onSend,
  version,
}: {
  onSend: (s: string) => Promise<void>;
  version: number;
}) {
  const [boards, setBoards] = useState<Board[]>([]),
    [board, setBoard] = useState<Board | null>(null),
    [selected, select] = useState<string[]>([]),
    [view, setView] = useState({ x: 32, y: 32, z: 1 }),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [tag, setTag] = useState(""),
    [message, setMessage] = useState("Loading"),
    [tasks, setTasks] = useState<TaskRow[]>([]),
    [space, setSpace] = useState(false),
    [marquee, setMarquee] = useState<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>(null);
  const canvas = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    history = useRef<Board[]>([]),
    future = useRef<Board[]>([]),
    clipboard = useRef<PlanItem[]>([]),
    dirty = useRef(false),
    saveQueue = useRef(Promise.resolve()),
    current = useRef(board);
  current.current = board;
  const change = (next: Board, record = true) => {
    if (!board) return;
    if (record) {
      history.current.push(board);
      if (history.current.length > 100) history.current.shift();
      future.current = [];
    }
    dirty.current = true;
    setBoard(next);
    setMessage("Unsaved");
  };
  const undo = (redo = false) => {
    const source = redo ? future : history,
      dest = redo ? history : future;
    const next = source.current.pop();
    if (next && board) {
      dest.current.push(board);
      dirty.current = true;
      setBoard(next);
    }
  };
  useEffect(() => {
    let live = true;
    request()
      .then(async (d) => {
        if (!live) return;
        let list = d.boards as Board[];
        if (!list.length) {
          const b = newBoard("My first plan");
          await request(`/${b.id}`, "PUT", b);
          list = [b];
        }
        if (live) {
          setBoards(list);
          let remembered = "";
          try {
            remembered = localStorage.getItem("wednesday:plan-board") ?? "";
          } catch {}
          setBoard(list.find((b) => b.id === remembered) ?? list[0]);
          setMessage("Saved");
        }
      })
      .catch((e) => setMessage(e.message));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (board) {
      try {
        localStorage.setItem("wednesday:plan-board", board.id);
      } catch {}
    }
  }, [board?.id]);
  useEffect(() => {
    const save = () => {
      const b = current.current;
      if (b && dirty.current)
        void fetch(`/api/plan/${b.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
          keepalive: true,
        });
    };
    addEventListener("pagehide", save);
    return () => removeEventListener("pagehide", save);
  }, []);
  useEffect(
    () => () => {
      const b = current.current;
      if (b && dirty.current) {
        dirty.current = false;
        saveQueue.current = saveQueue.current
          .catch(() => {})
          .then(() => request(`/${b.id}`, "PUT", b))
          .then(() => {})
          .catch(() => {});
      }
    },
    [],
  );
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .tasks()
        .then((d) => live && setTasks(d.tasks))
        .catch(() => {});
    void load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [version]);
  useEffect(() => {
    if (!board || !dirty.current) return;
    const snapshot = board;
    const t = setTimeout(() => {
      dirty.current = false;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          await request(`/${snapshot.id}`, "PUT", snapshot);
          setBoards((bs) =>
            bs.map((b) => (b.id === snapshot.id ? snapshot : b)),
          );
          if (current.current === snapshot) setMessage("Saved");
        })
        .catch((e) => {
          dirty.current = true;
          setMessage(e.message);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [board]);
  const flush = async () => {
    await saveQueue.current;
    if (board && dirty.current) {
      await request(`/${board.id}`, "PUT", board);
      dirty.current = false;
      setBoards((bs) => bs.map((b) => (b.id === board.id ? board : b)));
    }
  };
  const switchBoard = async (b: Board) => {
    if (b.id === board?.id) return;
    try {
      await flush();
      setBoard(b);
      select([]);
      history.current = [];
      future.current = [];
      setView({ x: 32, y: 32, z: 1 });
      setMessage("Saved");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const add = (kind: PlanItem["kind"], x?: number, y?: number) => {
    if (!board) return;
    const offset = (board.items.length % 8) * 28;
    change({
      ...board,
      items: [
        ...board.items,
        newItem(
          kind,
          x ?? -view.x / view.z + 40 + offset,
          y ?? -view.y / view.z + 40 + offset,
        ),
      ],
    });
  };
  const point = (x: number, y: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: (x - r.left - view.x) / view.z,
      y: (y - r.top - view.y) / view.z,
    };
  };
  const patch = (id: string, p: Partial<PlanItem>) =>
    board &&
    change({
      ...board,
      items: board.items.map((i) => (i.id === id ? { ...i, ...p } : i)),
    });
  const remove = () => {
    if (board)
      change({
        ...board,
        items: board.items.filter((i) => !selected.includes(i.id)),
        connectors: board.connectors.filter(
          (c) =>
            !selected.includes(c.id) &&
            !selected.includes(c.from) &&
            !selected.includes(c.to),
        ),
      });
    select([]);
  };
  const copy = () => {
    const ids = board ? withChildren(board.items, selected) : [];
    clipboard.current = board?.items.filter((i) => ids.includes(i.id)) ?? [];
  };
  const paste = () => {
    if (!board || !clipboard.current.length) return;
    const ids = new Map(
      clipboard.current.map((i) => [i.id, crypto.randomUUID()]),
    );
    const items = clipboard.current.map((i) => ({
      ...i,
      id: ids.get(i.id)!,
      x: i.x + 32,
      y: i.y + 32,
    }));
    change({
      ...board,
      items: [...board.items, ...items],
      connectors: [
        ...board.connectors,
        ...board.connectors
          .filter((c) => ids.has(c.from) && ids.has(c.to))
          .map((c) => ({
            ...c,
            id: crypto.randomUUID(),
            from: ids.get(c.from)!,
            to: ids.get(c.to)!,
          })),
      ],
    });
    select(items.map((i) => i.id));
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpace(true);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if (e.ctrlKey || e.metaKey) {
        if (["z", "y", "c", "v", "a"].includes(e.key)) e.preventDefault();
        if (e.key === "z") undo(e.shiftKey);
        if (e.key === "y") undo(true);
        if (e.key === "c") copy();
        if (e.key === "v") paste();
        if (e.key === "a") select(board?.items.map((i) => i.id) ?? []);
      }
    };
    const up = () => setSpace(false);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
    };
  });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!e.shiftKey) {
        const r = el.getBoundingClientRect(),
          px = e.clientX - r.left,
          py = e.clientY - r.top;
        setView((v) => {
          const z = Math.max(
            0.15,
            Math.min(3, v.z * Math.exp(-e.deltaY * 0.008)),
          );
          return {
            x: px - ((px - v.x) * z) / v.z,
            y: py - ((py - v.y) * z) / v.z,
            z,
          };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [!!board]);
  const fit = () => {
    if (!board?.items.length || !canvas.current) return;
    const minX = Math.min(...board.items.map((i) => i.x)),
      minY = Math.min(...board.items.map((i) => i.y)),
      w = Math.max(...board.items.map((i) => i.x + i.w)) - minX,
      h = Math.max(...board.items.map((i) => i.y + i.h)) - minY;
    const z = Math.min(
      1,
      (canvas.current.clientWidth - 64) / w,
      (canvas.current.clientHeight - 64) / h,
    );
    setView({ x: 32 - minX * z, y: 32 - minY * z, z: Math.max(0.15, z) });
  };
  const drag = (e: React.PointerEvent, id?: string, resize = false) => {
    if (!board || !canvas.current) return;
    if (
      (e.target as HTMLElement).closest("input,textarea,select,button") &&
      !resize
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const start = point(e.clientX, e.clientY),
      vx = e.clientX,
      vy = e.clientY,
      original = board;
    let ids = id ? (selected.includes(id) ? selected : [id]) : [];
    if (id && e.shiftKey) {
      select(
        selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id],
      );
      return;
    }
    if (id) {
      select(ids);
      ids = resize ? [id] : withChildren(board.items, ids);
    } else if (!space && e.button !== 1) select([]);
    const pan = space || e.button === 1;
    let next = original,
      moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const dx = (ev.clientX - vx) / view.z,
        dy = (ev.clientY - vy) / view.z;
      if (pan)
        setView({
          ...view,
          x: view.x + ev.clientX - vx,
          y: view.y + ev.clientY - vy,
        });
      else if (id) {
        next = {
          ...original,
          items: original.items.map((i) =>
            ids.includes(i.id)
              ? resize
                ? {
                    ...i,
                    w: Math.min(5000, Math.max(100, i.w + dx)),
                    h: Math.min(5000, Math.max(80, i.h + dy)),
                  }
                : { ...i, x: i.x + dx, y: i.y + dy }
              : i,
          ),
        };
        setBoard(next);
      } else {
        const box = {
          x: Math.min(start.x, start.x + dx),
          y: Math.min(start.y, start.y + dy),
          w: Math.abs(dx),
          h: Math.abs(dy),
        };
        setMarquee(box);
        select(
          original.items
            .filter(
              (i) =>
                i.x < box.x + box.w &&
                i.x + i.w > box.x &&
                i.y < box.y + box.h &&
                i.y + i.h > box.y,
            )
            .map((i) => i.id),
        );
      }
    };
    const end = () => {
      if (id && moved && !pan) {
        history.current.push(original);
        future.current = [];
        dirty.current = true;
        setBoard({ ...next });
      }
      setMarquee(null);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
  };
  const importFile = async (f: File) => {
    try {
      const v = JSON.parse(await f.text());
      if (v.items && v.connectors && v.id) {
        const b = boardSchema.parse({ ...v, id: crypto.randomUUID() });
        await request(`/${b.id}`, "PUT", b);
        setBoards((bs) => [...bs, b]);
        await switchBoard(b);
      } else if (board)
        change({ ...board, items: [...board.items, ...importIdeas(v)] });
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
  };
  const active = board?.items.find((i) => selected.includes(i.id));
  return (
    <>
      <PageHead title="Plan">
        <span className="plan-save" role="status">
          {message}
        </span>
      </PageHead>
      <div className="plan-tools">
        <select
          aria-label="Board"
          value={board?.id ?? ""}
          onChange={(e) =>
            void switchBoard(boards.find((b) => b.id === e.target.value)!)
          }
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            try {
              const b = newBoard();
              await flush();
              await request(`/${b.id}`, "PUT", b);
              setBoards((bs) => [...bs, b]);
              void switchBoard(b);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          New board
        </button>
        <button
          onClick={() => {
            const name = prompt("Board name", board?.name);
            if (name?.trim() && board) change({ ...board, name: name.trim() });
          }}
        >
          Rename
        </button>
        <button
          disabled={!board}
          onClick={async () => {
            if (!board || !confirm(`Delete ${board.name}?`)) return;
            try {
              await flush();
              await request(`/${board.id}`, "DELETE");
              const rest = boards.filter((b) => b.id !== board.id);
              setBoards(rest);
              setBoard(rest[0] ?? null);
              history.current = [];
              future.current = [];
              select([]);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Delete board
        </button>
        <button
          onClick={async () => {
            try {
              await flush();
              setMessage("Saved");
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Save now
        </button>
        <button onClick={() => file.current?.click()}>Import</button>
        <input
          ref={file}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => {
            if (!board) return;
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(board, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `${board.name}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export
        </button>
      </div>
      <div className="plan-tools">
        <button onClick={() => add("note")}>+ Note</button>
        <button onClick={() => add("card")}>+ Idea</button>
        <button onClick={() => add("group")}>+ Frame</button>
        <button
          disabled={
            selected.length !== 2 ||
            selected.some((id) => !board?.items.some((i) => i.id === id))
          }
          onClick={() =>
            board &&
            change({
              ...board,
              connectors: [
                ...board.connectors,
                { id: crypto.randomUUID(), from: selected[0], to: selected[1] },
              ],
            })
          }
        >
          Connect →
        </button>
        <button onClick={() => undo()}>Undo</button>
        <button onClick={() => undo(true)}>Redo</button>
        <button disabled={!selected.length} onClick={remove}>
          Delete
        </button>
        <input
          aria-label="Search ideas"
          placeholder="Search ideas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          aria-label="Filter tag"
          placeholder="Tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <select
          aria-label="Filter status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All states</option>
          {["idea", "planned", "doing", "done"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="plan-workspace">
        <div
          className={`plan-canvas${space ? " is-panning" : ""}`}
          ref={canvas}
          onPointerDown={(e) => drag(e)}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) {
              const p = point(e.clientX, e.clientY);
              add("note", p.x, p.y);
            }
          }}
          aria-label="Planning canvas"
        >
          <div
            className="plan-world"
            style={{
              transform: `translate(${view.x}px,${view.y}px) scale(${view.z})`,
            }}
          >
            <svg className="plan-lines">
              <defs>
                <marker
                  id="plan-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10" fill="var(--blue-deep)" />
                </marker>
              </defs>
              {board?.connectors.map((c) => {
                const a = board.items.find((i) => i.id === c.from),
                  b = board.items.find((i) => i.id === c.to);
                const ends = a && b ? connectorEnds(a, b) : null;
                return ends ? (
                  <line
                    key={c.id}
                    x1={ends.from.x}
                    y1={ends.from.y}
                    x2={ends.to.x}
                    y2={ends.to.y}
                    markerEnd="url(#plan-arrow)"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      select([c.id]);
                    }}
                    className={selected.includes(c.id) ? "selected" : ""}
                  />
                ) : null;
              })}
            </svg>
            {board?.items
              .slice()
              .sort(
                (a, b) =>
                  Number(b.kind === "group") - Number(a.kind === "group"),
              )
              .map((i) => (
                <article
                  key={i.id}
                  className={`plan-item plan-item--${i.kind} plan-color--${i.color}${selected.includes(i.id) ? " is-selected" : ""}${!`${i.title} ${i.body} ${i.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()) || (status && i.status !== status) || (tag && !i.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))) ? " is-filtered" : ""}`}
                  style={{ left: i.x, top: i.y, width: i.w, height: i.h }}
                  onPointerDown={(e) => drag(e, i.id)}
                >
                  <div
                    className="plan-handle"
                    title="Drag to move"
                    onPointerDown={(e) => drag(e, i.id)}
                  >
                    ⠿ {i.kind}
                  </div>
                  <input
                    aria-label={`${i.kind} title`}
                    value={i.title}
                    onChange={(e) => patch(i.id, { title: e.target.value })}
                  />
                  {i.kind !== "group" && (
                    <>
                      <textarea
                        aria-label={`${i.title} body`}
                        placeholder="Write a thought..."
                        value={i.body}
                        onChange={(e) => patch(i.id, { body: e.target.value })}
                      />
                      <div className="plan-item-meta">
                        {i.kind === "card" && (
                          <span className="chip chip--static">{i.status}</span>
                        )}
                        {i.tags.map((t) => (
                          <span key={t} className="chip chip--static">
                            #{t}
                          </span>
                        ))}
                        {i.tasks.map((id) => {
                          const t = tasks.find((t) => `T${t.id}` === id);
                          return (
                            <span
                              key={id}
                              className="chip chip--static"
                              title={t?.title}
                            >
                              {id} ·{" "}
                              {t
                                ? `${t.title} · ${t.status}`
                                : "Task unavailable"}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <button
                    className="plan-resize"
                    aria-label={`Resize ${i.title}`}
                    onPointerDown={(e) => drag(e, i.id, true)}
                  >
                    ↘
                  </button>
                </article>
              ))}
            {marquee && (
              <div
                className="plan-marquee"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.w,
                  height: marquee.h,
                }}
              />
            )}
          </div>
        </div>
        {active && (
          <aside className="plan-inspector">
            <b>
              {selected.length > 1
                ? `${selected.length} selected`
                : active.kind === "group"
                  ? "Frame"
                  : "Idea details"}
            </b>
            <label>
              Colour
              <select
                value={active.color}
                onChange={(e) =>
                  patch(active.id, {
                    color: e.target.value as PlanItem["color"],
                  })
                }
              >
                {["plain", "blue", "mint", "amber", "pink"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {active.kind !== "group" && (
              <>
                <label>
                  Status
                  <select
                    value={active.status}
                    onChange={(e) =>
                      patch(active.id, {
                        status: e.target.value as PlanItem["status"],
                      })
                    }
                  >
                    {["idea", "planned", "doing", "done"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tags
                  <input
                    key={active.id + "tags"}
                    defaultValue={active.tags.join(", ")}
                    onBlur={(e) =>
                      patch(active.id, {
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <label>
                  Task ids
                  <input
                    placeholder="T12, T53"
                    key={active.id + "tasks"}
                    defaultValue={active.tasks.join(", ")}
                    onBlur={(e) =>
                      patch(active.id, {
                        tasks: e.target.value.match(/T\d+/g) ?? [],
                      })
                    }
                  />
                </label>
                <button
                  onClick={async () => {
                    try {
                      await onSend(
                        `[Plan: ${board?.name}]\n${active.title}\n\n${active.body}\nTags: ${active.tags.join(", ")}\nTasks: ${active.tasks.join(", ")}`,
                      );
                      setMessage("Sent to Wednesday");
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  Send to Wednesday
                </button>
              </>
            )}
            <button onClick={copy}>Copy selected</button>
            <button onClick={paste}>Paste</button>
          </aside>
        )}
      </div>
      <footer className="plan-footer">
        <span>
          Double-click for a note · Space-drag to pan · Wheel/pinch to zoom ·
          Shift-wheel to pan · Shift-click to select
        </span>
        <button onClick={fit}>Fit</button>
        <button onClick={() => setView({ x: 32, y: 32, z: 1 })}>
          {Math.round(view.z * 100)}% Reset
        </button>
        <button
          aria-label="Zoom out"
          onClick={() =>
            setView((v) => ({ ...v, z: Math.max(0.15, v.z / 1.2) }))
          }
        >
          −
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => setView((v) => ({ ...v, z: Math.min(3, v.z * 1.2) }))}
        >
          +
        </button>
      </footer>
    </>
  );
}
