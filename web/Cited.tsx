import type { MouseEvent } from "react";
import { splitCitations } from "./thread";

type OnRef = (ref: string, e: MouseEvent<HTMLElement>) => void;

/** Plain text with [F3]-style citations as chips. */
export function Cited({ text, onRef }: { text: string; onRef: OnRef }) {
  return (
    <>
      {splitCitations(text).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={i}>
            {part.map((ref) => (
              <button key={ref} className="chip" onClick={(e) => onRef(ref, e)}>
                {ref}
              </button>
            ))}
          </span>
        ),
      )}
    </>
  );
}

