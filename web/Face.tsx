// Character face, copied from agent-hq (src/components/Face.tsx). Keep the two in sync.
import type { CSSProperties } from "react";
export type Mood = "idle" | "working" | "needs" | "error" | "offline";

/** Stable per-id number (FNV-1a), so each character keeps its features. */
export function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Props {
  id: string;
  mood: Mood;
  color: string;
  human?: boolean;
  size: number;
  badge?: boolean;
}

const W = "#ffffff";

/**
 * A character face. Body color is the runtime, expression is the mood, and a
 * per-agent seed tilts the eyes and sizes the mouth so no two look alike.
 */
export function Face({ id, mood, color, human = false, size, badge = true }: Props) {
  const s = seed(id);
  const tilt = ((s % 7) - 3) * 2.2; // -6.6 .. 6.6 deg
  const mouthW = 22 + (s % 5) * 3; // 22 .. 34
  const eyeGap = 15 + ((s >> 3) % 4) * 1.5; // spacing from center
  const blinkDelay = `${(s % 50) / 10}s`;
  const body = mood === "offline" ? "var(--sleep)" : color;

  return (
    <span
      className={`face face--${mood}`}
      style={{ width: size, height: size, "--blink-delay": blinkDelay } as CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {human ? (
          <circle cx="50" cy="50" r="48" fill={body} />
        ) : (
          <rect x="2" y="2" width="96" height="96" rx="26" fill={body} />
        )}
        <g className="face__eyes">{eyes(mood, tilt, eyeGap)}</g>
        <g className="face__mouth">{mouth(mood, mouthW)}</g>
      </svg>
      {badge && mood !== "idle" && mood !== "working" && (
        <span className={`face__badge face__badge--${mood}`}>{mood === "needs" ? "!" : mood === "error" ? "×" : "z"}</span>
      )}
    </span>
  );
}

function eyes(mood: Mood, tilt: number, gap: number) {
  const lx = 50 - gap - 9;
  const rx = 50 + gap - 9;
  switch (mood) {
    case "needs":
      return (
        <>
          <circle cx={lx + 9} cy="40" r="10" fill={W} />
          <circle cx={rx + 9} cy="40" r="10" fill={W} />
        </>
      );
    case "error":
      return (
        <g stroke={W} strokeWidth="6" strokeLinecap="round">
          <path d={`M${lx + 2} 33 l14 14 M${lx + 16} 33 l-14 14`} />
          <path d={`M${rx + 2} 33 l14 14 M${rx + 16} 33 l-14 14`} />
        </g>
      );
    case "offline":
      return (
        <g stroke={W} strokeWidth="5" strokeLinecap="round" fill="none">
          <path d={`M${lx + 1} 40 q8 7 16 0`} />
          <path d={`M${rx + 1} 40 q8 7 16 0`} />
        </g>
      );
    case "working":
      // Focused: inner corners pulled down.
      return (
        <>
          <rect x={lx} y="34" width="18" height="11" rx="5" fill={W} transform={`rotate(${12} ${lx + 9} 40)`} />
          <rect x={rx} y="34" width="18" height="11" rx="5" fill={W} transform={`rotate(${-12} ${rx + 9} 40)`} />
        </>
      );
    default:
      // Relaxed slit eyes, as in the sketch.
      return (
        <>
          <rect x={lx} y="34" width="19" height="12" rx="5" fill={W} transform={`rotate(${-8 + tilt} ${lx + 9} 40)`} />
          <rect x={rx} y="34" width="19" height="12" rx="5" fill={W} transform={`rotate(${-8 + tilt} ${rx + 9} 40)`} />
        </>
      );
  }
}

function mouth(mood: Mood, w: number) {
  switch (mood) {
    case "needs":
      return <ellipse cx="50" cy="68" rx="6" ry="7" fill={W} />;
    case "error":
      return <path d="M34 70 q4 -6 8 0 t8 0 t8 0 t8 0" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" />;
    case "offline":
      return <rect x={50 - w / 4} y="66" width={w / 2} height="5" rx="2.5" fill={W} />;
    case "working":
      return <rect x={50 - w / 2.6} y="64" width={w / 1.3} height="8" rx="4" fill={W} />;
    default:
      return <rect x={50 - w / 2} y="62" width={w} height="8" rx="4" fill={W} transform="translate(50 66) skewX(-12) translate(-50 -66)" />;
  }
}
