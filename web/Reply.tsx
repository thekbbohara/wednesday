import { useState } from "react";

/** One-line reply box: an agent's next input, or the owner's answer about a task. */
export function Reply({ placeholder, onSend, sent }: { placeholder: string; onSend: (text: string) => Promise<unknown>; sent?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr("");
    setDone(false);
    // Clear first so typing during the request is not wiped; restore on failure.
    setText("");
    try {
      await onSend(t);
      setDone(true);
    } catch (e) {
      setText(t);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="reply__input"
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setDone(false);
          }}
        />
        <button className="reply__send" disabled={!text.trim() || busy}>
          {busy ? "Sending" : "Send"}
        </button>
      </form>
      {err && <p className="answer__err">{err}</p>}
      {done && sent && <p className="reply__sent">{sent}</p>}
    </>
  );
}
