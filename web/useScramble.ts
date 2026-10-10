import { useEffect, useRef, useState } from "react";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Characters used while a value scrambles before settling. */
const GLYPHS = "0123456789";

/**
 * Returns `value`, but when it changes the display cycles through random
 * glyphs for a few frames before settling - a decrypt-style reveal for
 * numbers. Instant under prefers-reduced-motion and on first render.
 */
export function useScramble(value: string | number, durationMs = 320): string {
  const [display, setDisplay] = useState(String(value));
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const next = String(value);
    if (first.current) {
      first.current = false;
      setDisplay(next);
      return;
    }
    if (reduced() || next === display) {
      setDisplay(next);
      return;
    }
    if (timer.current) clearInterval(timer.current);
    const start = performance.now();
    timer.current = setInterval(() => {
      const t = (performance.now() - start) / durationMs;
      if (t >= 1) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setDisplay(next);
        return;
      }
      // Resolve left-to-right: settled prefix, scrambling suffix.
      const settled = Math.floor(next.length * t);
      let s = next.slice(0, settled);
      for (let i = settled; i < next.length; i++) {
        const c = next[i];
        s += c >= "0" && c <= "9" ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c;
      }
      setDisplay(s);
    }, 40);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return display;
}
