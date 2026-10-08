import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toggle } from "./Toggle";

interface Provider { id: string; saved: boolean; masked: string; source: string }
interface View { providers: Provider[]; voices: { wednesday: string; owner: string }; telegramVoice: boolean }

const NAMES: Record<string, string> = { elevenlabs: "ElevenLabs", openrouter: "OpenRouter" };
const HINTS: Record<string, string> = {
  elevenlabs: "Voice replies. Find it in ElevenLabs under Developers > API keys.",
  openrouter: "Models through OpenRouter.",
};
const label = (id: string) => NAMES[id] ?? id[0].toUpperCase() + id.slice(1);
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,40}$/;
const VOICE_ID = /^[a-zA-Z0-9]{10,64}$/;

async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/keys${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || "Could not reach the server.");
  return body;
}
const put = (body: object): Promise<View> =>
  call("", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Settings groups for API keys and voice replies. Saved keys never come back to the browser; only the last 4 characters. */
export function ApiKeys() {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState({ id: "", key: "" });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    call("").then(setView, (e) => setLoadError(e.message));
  }, []);

  const save = async (field: string, body: object, after?: () => void, savedField = field) => {
    setBusy(field);
    try {
      setView(await put(body));
      setErrors((e) => ({ ...e, [field]: "" }));
      setNotes((n) => ({ ...n, [field]: { ok: true, text: "" } }));
      after?.();
      setSaved(savedField);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(null), 1600);
    } catch (e) {
      setErrors((cur) => ({ ...cur, [field]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string) => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const r = await call(`/${id}/test`, { method: "POST" });
      setNotes((n) => ({ ...n, [id]: { ok: true, text: r.message } }));
    } catch (e) {
      setNotes((n) => ({ ...n, [id]: { ok: false, text: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  };

  const savedMark = (field: string) => (
    <span className={`setting__saved${saved === field ? " is-on" : ""}`} aria-live="polite">
      {saved === field ? "Saved" : ""}
    </span>
  );

  if (!view)
    return (
      <>
        <p className="micro">API keys</p>
        <p className={loadError ? "setting__error" : "setting__hint"}>{loadError || "Loading keys…"}</p>
      </>
    );

  const keyRow = (p: Provider) => {
    const draft = drafts[p.id] ?? "";
    const note = notes[p.id];
    const commit = () => draft.trim() && save(p.id, { provider: p.id, key: draft }, () => setDrafts((d) => ({ ...d, [p.id]: "" })));
    return (
      <div className="setting setting--key" key={p.id}>
        <div className="setting__text">
          <label className="setting__label" htmlFor={`key-${p.id}`}>
            {label(p.id)}
          </label>
          {HINTS[p.id] && <p className="setting__hint">{HINTS[p.id]}</p>}
          <p className={`setting__account ${p.saved ? "is-on" : "is-none"}`}>
            <span className="setting__dot" aria-hidden="true" />
            {p.saved ? (
              <>
                <span>Saved</span>
                <span className="mono">{p.masked}</span>
                {p.source === "elevenlabs.env" && <span>from elevenlabs.env</span>}
              </>
            ) : (
              <span>Not saved</span>
            )}
          </p>
          {note?.text && <p className={note.ok ? "setting__ok" : "setting__error"}>{note.text}</p>}
          {errors[p.id] && <p className="setting__error">{errors[p.id]}</p>}
        </div>
        <div className="setting__control key-control">
          {savedMark(p.id)}
          <input
            id={`key-${p.id}`}
            name={`key-${p.id}`}
            className="input input--key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={p.saved ? "Paste a new key" : "Paste key"}
            value={draft}
            onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          <button type="button" className="pill-btn pill-btn--primary" disabled={!!busy || !draft.trim()} onClick={commit}>
            Save
          </button>
          {p.id === "elevenlabs" && (
            <button type="button" className="pill-btn" disabled={!!busy || !p.saved} onClick={() => test(p.id)}>
              {busy === p.id && !draft ? "Testing…" : "Test"}
            </button>
          )}
          {p.source === "keys.json" && p.id !== "elevenlabs" && (
            <button type="button" className="pill-btn" disabled={!!busy} aria-label={`Remove ${label(p.id)} key`} onClick={() => save(p.id, { provider: p.id, remove: true })}>
              Remove
            </button>
          )}
        </div>
      </div>
    );
  };

  const extraValid = PROVIDER_ID.test(extra.id) && extra.key.trim().length >= 8;
  const addExtra = () => extraValid && save("extra", { provider: extra.id, key: extra.key }, () => setExtra({ id: "", key: "" }), extra.id);

  return (
    <>
      <p className="micro">API keys</p>
      <p className="setting__hint settings__lede">Stored on this computer only (chmod 600). A saved key is never shown again; paste a new one to replace it.</p>
      {view.providers.map(keyRow)}
      <div className="setting setting--key">
        <div className="setting__text">
          <label className="setting__label" htmlFor="key-extra-id">
            Another provider
          </label>
          <p className="setting__hint">Lowercase id, for example groq or anthropic.</p>
          {errors.extra && <p className="setting__error">{errors.extra}</p>}
        </div>
        <div className="setting__control key-control">
          {savedMark("extra")}
          <input
            id="key-extra-id"
            name="key-extra-id"
            className="input input--provider"
            spellCheck={false}
            autoComplete="off"
            placeholder="provider"
            value={extra.id}
            onChange={(e) => setExtra((x) => ({ ...x, id: e.target.value.toLowerCase().trim() }))}
          />
          <input
            aria-label="Provider key"
            className="input input--key input--key-short"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste key"
            value={extra.key}
            onChange={(e) => setExtra((x) => ({ ...x, key: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addExtra()}
          />
          <button type="button" className="pill-btn pill-btn--primary" disabled={!!busy || !extraValid} onClick={addExtra}>
            Add
          </button>
        </div>
      </div>

      <p className="micro">Voice replies</p>
      {(["wednesday", "owner"] as const).map((id) => (
        <VoiceRow key={id} id={id} value={view.voices[id]} error={errors[`voice-${id}`]} savedMark={savedMark(`voice-${id}`)}
          onCommit={(v) => save(`voice-${id}`, { voices: { ...view.voices, [id]: v } })} />
      ))}
      <div className="setting">
        <div className="setting__text">
          <label className="setting__label" htmlFor="set-telegramVoice">
            Always reply by voice on Telegram
          </label>
          <p className="setting__hint">Off: only voice notes get a voice reply. Replies over 800 characters, or when audio fails, arrive as text.</p>
          {errors.telegramVoice && <p className="setting__error">{errors.telegramVoice}</p>}
        </div>
        <div className="setting__control">
          {savedMark("telegramVoice")}
          <Toggle id="set-telegramVoice" label="Always reply by voice on Telegram" on={view.telegramVoice} disabled={!!busy}
            onChange={(telegramVoice) => save("telegramVoice", { telegramVoice })} />
        </div>
      </div>
    </>
  );
}

function VoiceRow({ id, value, error, savedMark, onCommit }: { id: "wednesday" | "owner"; value: string; error?: string; savedMark: ReactNode; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const invalid = v.trim() !== "" && !VOICE_ID.test(v.trim());
  const commit = () => {
    if (v.trim() !== value && VOICE_ID.test(v.trim())) onCommit(v.trim());
  };
  return (
    <div className="setting">
      <div className="setting__text">
        <label className="setting__label" htmlFor={`voice-${id}`}>
          {id === "wednesday" ? "Wednesday voice" : "Owner voice"}
        </label>
        <p className="setting__hint">{id === "wednesday" ? "ElevenLabs voice ID Wednesday speaks with." : "ElevenLabs voice ID cloned from the owner."}</p>
        {(error || invalid) && <p className="setting__error">{error || "10-64 letters or digits."}</p>}
      </div>
      <div className="setting__control">
        {savedMark}
        <input
          id={`voice-${id}`}
          name={`voice-${id}`}
          className="input input--path"
          spellCheck={false}
          autoComplete="off"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </div>
    </div>
  );
}
