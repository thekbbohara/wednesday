import { useEffect, useState } from "react";
import type { SystemStats } from "../src/system-types";

const REFRESH_MS = 5_000;

/** ok under 80, warn from 80, crit from 90 (percent or degrees C). */
const level = (v: number | undefined) => v === undefined ? "ok" : v >= 90 ? "crit" : v >= 80 ? "warn" : "ok";
const pct = (used: number, total: number) => total > 0 ? (used / total) * 100 : 0;
const gib = (b: number) => {
  const g = b / 1024 ** 3;
  return g >= 100 ? `${Math.round(g)}` : g >= 10 ? g.toFixed(1) : g.toFixed(2);
};
const size = (b: number) => b >= 1024 ** 3 ? `${gib(b)} GiB` : `${Math.round(b / 1024 ** 2)} MiB`;
const uptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

function Ring({ value, label, tone = level(value) }: { value: number; label: string; tone?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return <div className={`sys-ring sys--${tone}`} role="img" aria-label={`${label} ${Math.round(value)}%`}>
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} className="sys-ring__track" />
      <circle cx="32" cy="32" r={r} className="sys-ring__value" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, value) / 100)} />
    </svg>
    <span>{Math.round(value)}<small>%</small></span>
  </div>;
}

function Bar({ value, label, detail }: { value: number; label: string; detail: string }) {
  return <div className="sys-bar">
    <div className="sys-bar__head"><span>{label}</span><span className="mono">{detail}</span></div>
    <div className={`sys-bar__track sys--${level(value)}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <i style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  </div>;
}

function Temp({ c }: { c: number | undefined }) {
  return c === undefined ? null : <span className={`sys-temp sys-text--${level(c)}`}>{Math.round(c)}°C</span>;
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return <article className={`sys-card${wide ? " sys-card--wide" : ""}`}><h3 className="micro">{title}</h3>{children}</article>;
}

function PlugIcon() {
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4" />
  </svg>;
}

export function SystemPanel() {
  const [data, setData] = useState<SystemStats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    // One request at a time, and none while the tab is hidden: the endpoint reads the live machine.
    const load = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch("/api/system");
          if (!r.ok) throw new Error(`Could not read system stats (HTTP ${r.status}).`);
          const d = await r.json() as SystemStats;
          if (live) { setData(d); setError(""); }
        } catch (e) { if (live) setError((e as Error).message); }
      }
      if (live) timer = setTimeout(load, REFRESH_MS);
    };
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void load(); } };
    void load();
    document.addEventListener("visibilitychange", wake);
    return () => { live = false; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, []);

  if (!data) return <section className="sys" aria-label="This PC">
    <h3 className="micro">This PC</h3>
    {error ? <p className="credits-error" role="alert">{error}</p> : <p className="credits-intro">Reading system stats…</p>}
  </section>;

  const { cpu, memory: m, power: p } = data;
  const ram = pct(m.used, m.total);
  return <section className="sys" aria-label="This PC">
    <div className="sys-head">
      <h3 className="micro">This PC</h3>
      <span className="sys-host mono">{data.hostname} · up {uptime(data.uptime)}</span>
      <span className={`sys-live${error ? " sys-live--off" : ""}`} title={error || `Updated ${new Date(data.checkedAt).toLocaleTimeString()}`}>{error ? "Offline" : "Live"}</span>
    </div>
    {error && <p className="credits-error" role="alert">{error} Showing the last reading.</p>}
    <div className="sys-grid">
      <Card title="CPU">
        <div className="sys-main"><Ring value={cpu.percent} label="CPU" /><div className="sys-facts">
          <strong>{cpu.count} cores</strong>
          <span className="mono">load {cpu.load.map(l => l.toFixed(2)).join(" ")}</span>
          <Temp c={cpu.temp} />
        </div></div>
        {cpu.cores.length > 0 && <div className="sys-cores" aria-label="Per-core use">
          {cpu.cores.map((v, i) => <i key={i} className={`sys--${level(v)}`} title={`Core ${i}: ${Math.round(v)}%`}><b style={{ height: `${Math.max(4, v)}%` }} /></i>)}
        </div>}
        <p className="sys-note" title={cpu.model}>{cpu.model}</p>
      </Card>
      <Card title="Memory">
        <div className="sys-main"><Ring value={ram} label="Memory" /><div className="sys-facts">
          <strong>{gib(m.used)} / {gib(m.total)} GiB</strong>
          <span>{gib(m.available)} GiB available</span>
        </div></div>
        {m.swapTotal > 0 ? <Bar value={pct(m.swapUsed, m.swapTotal)} label="Swap" detail={`${size(m.swapUsed)} / ${size(m.swapTotal)}`} /> : <p className="sys-note">No swap</p>}
      </Card>
      {data.gpus.map((g, i) => <Card key={i} title="GPU">
        <div className="sys-main"><Ring value={g.util ?? 0} label="GPU" /><div className="sys-facts">
          <strong title={g.name}>{g.name.replace(/^NVIDIA (GeForce )?/, "")}</strong>
          {g.power !== undefined && <span className="mono">{g.power.toFixed(1)} W{g.powerLimit ? ` / ${Math.round(g.powerLimit)} W` : ""}</span>}
          <Temp c={g.temp} />
        </div></div>
        {g.memTotal ? <Bar value={pct(g.memUsed ?? 0, g.memTotal)} label="VRAM" detail={`${size(g.memUsed ?? 0)} / ${size(g.memTotal)}`} /> : null}
      </Card>)}
      <Card title="Power">
        {p.kind === "battery" ? <>
          <div className="sys-main"><Ring value={p.percent} label="Battery" tone={p.percent <= 10 ? "crit" : p.percent <= 20 ? "warn" : "ok"} /><div className="sys-facts">
            <strong>{p.status === "Charging" ? "Charging" : p.status === "Full" ? "Full" : p.status === "Discharging" ? "On battery" : p.status}</strong>
            <span>{p.ac ? "AC connected" : p.ac === false ? "AC unplugged" : ""}</span>
          </div></div>
        </> : <div className="sys-main"><span className={`sys-plug${p.online === false ? " sys-plug--off" : ""}`}><PlugIcon /></span><div className="sys-facts">
          <strong>No battery</strong>
          <span>{p.online === false ? "AC reports offline" : "On AC power"}</span>
        </div></div>}
      </Card>
      <Card title="Disks" wide>
        {data.disks.length ? data.disks.map(d => <Bar key={d.mount} value={d.percent} label={d.mount} detail={`${size(d.free)} free of ${size(d.total)}`} />) : <p className="sys-note">No disks found</p>}
      </Card>
      <Card title="Top processes" wide>
        <div className="sys-top">
          {([["CPU", data.top.cpu, (r: SystemStats["top"]["cpu"][number]) => `${Math.round(r.cpu)}%`], ["Memory", data.top.memory, (r: SystemStats["top"]["cpu"][number]) => size(r.rss)]] as const).map(([label, rows, fmt]) =>
            <ol key={label} aria-label={`Top by ${label}`}>
              <li className="sys-top__head"><span>By {label}</span></li>
              {rows.length ? rows.map(r => <li key={r.name}><span className="mono">{r.name}{r.count > 1 && <em> ×{r.count}</em>}</span><b className="mono">{fmt(r)}</b></li>) : <li className="sys-note">Idle</li>}
            </ol>)}
        </div>
      </Card>
    </div>
  </section>;
}
