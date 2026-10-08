export function Toggle({ id, on, onChange, label, disabled }: { id: string; on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button id={id} role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " is-on" : ""}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}
