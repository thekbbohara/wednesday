import { useEffect, useState } from "react";
import { PageHead } from "./pages";
import type { CreditAccount } from "../src/credits-types";

export function CreditsPage() {
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/credits");
        if (!r.ok) throw new Error(`Could not load credits (HTTP ${r.status}).`);
        const data = await r.json() as { accounts: CreditAccount[] };
        if (live) { setAccounts(data.accounts); setError(""); }
      } catch (e) { if (live) setError((e as Error).message); }
      finally { if (live) setLoading(false); }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [version]);
  const time = (s: string) => new Date(s).toLocaleString(undefined, { timeZoneName: "short" });
  return <>
    <PageHead title="Runtime usage and credits"><button className="credits-refresh" disabled={loading} onClick={() => setVersion(v => v + 1)}>{loading ? "Checking…" : "Refresh"}</button></PageHead>
    <div className="page__body">
      <p className="credits-intro">Account allowances reported by providers. Each window has its own limit. Checks are cached for 60 seconds.</p>
      {error && <p className="credits-error" role="alert">{error} {accounts.length > 0 && "Previously loaded results are shown below."}</p>}
      {accounts.length > 0 && <p className="credits-summary">{accounts.filter(a => a.status === "available").length} reporting · {accounts.filter(a => a.status === "unavailable").length} unavailable{accounts.some(a => a.status === "stale") ? ` · ${accounts.filter(a => a.status === "stale").length} stale` : ""}</p>}
      <div className="credits-grid" aria-live="polite">
        {accounts.map(a => <article className="credit-card" key={a.id}>
          <div className="credit-card__head"><h3>{a.runtime}</h3><span className={`credit-state credit-state--${a.status}`}>{a.status === "available" ? "Reported" : a.status === "stale" ? "Stale" : "Unavailable"}</span></div>
          <p className="credit-account mono">{a.account}</p>
          {a.reason && <p className="credits-error">{a.reason}</p>}
          {a.allowances.map((w, i) => <div className="credit-window" key={i}>
            <div className="credit-window__head"><span>{w.label}</span><strong>{w.remainingPercent !== undefined ? `${Number(w.remainingPercent.toFixed(2))}% remaining` : w.remaining}</strong></div>
            {w.remainingPercent !== undefined && <progress className={w.remainingPercent <= 10 ? "credit-low" : ""} value={w.remainingPercent} max={100} aria-label={`${w.label} remaining`} />}
            {w.remainingPercent !== undefined && w.remaining && <p>{w.remaining}</p>}
            <p>{w.resetsAt ? `Resets ${time(w.resetsAt)}` : "Reset time not reported"}</p>
          </div>)}
          {a.note && <p className="credit-note">{a.note}</p>}
          <footer className="credit-meta"><span>{a.source}</span><span>{a.fetchedAt ? `Reported ${time(a.fetchedAt)}` : "No allowance retrieved"}</span><span>Checked {time(a.checkedAt)}</span></footer>
        </article>)}
      </div>
    </div>
  </>;
}
