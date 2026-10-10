import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mediaUrl, type MediaRef } from "./api";

type Kind = MediaRef["kind"];

const EXT_KIND: [RegExp, Kind][] = [
  [/\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|heic)$/i, "image"],
  [/\.(mp4|m4v|mov|webm|mkv|ogv)$/i, "video"],
  [/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i, "audio"],
];

/** A kind from the file name, for markdown images and files not uploaded yet. */
export function kindOfName(name: string, mime = ""): Kind {
  if (/^(image|video|audio)\//.test(mime)) return mime.split("/")[0] as Kind;
  return EXT_KIND.find(([re]) => re.test(name))?.[1] ?? "file";
}

/** "/abs", "~/x" or "file:///abs": a local file, served by /api/media. */
export function isLocalPath(src: string | undefined): src is string {
  return !!src && (/^file:\/\//i.test(src) || src.startsWith("~/") || (src.startsWith("/") && !src.startsWith("//")));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** The upload stamp ("20261010-070509-") is for the disk, not for people. */
export function displayName(name: string): string {
  return name.replace(/^\d{8}-\d{6}-/, "");
}

/** The files a message shows, beside its bubble: images, players, file chips. */
export function MediaList({ media, side }: { media: MediaRef[]; side: "owner" | "captain" }) {
  const images = media.filter((m) => m.kind === "image");
  const rest = media.filter((m) => m.kind !== "image");
  return (
    <div className={`media media--${side}`}>
      {images.length > 0 && (
        <div className={`media__images${images.length > 1 ? " media__images--grid" : ""}`}>
          {images.map((m) => (
            <MediaImage key={m.path} path={m.path} name={m.name} size={m.size} />
          ))}
        </div>
      )}
      {rest.map((m) => (
        <MediaItem key={m.path} path={m.path} name={m.name} kind={m.kind} size={m.size} />
      ))}
    </div>
  );
}

/** One file by kind; a chip when the browser cannot show it. */
export function MediaItem({ path, name, kind, size, alt }: { path: string; name: string; kind: Kind; size?: number; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || kind === "file") return <FileChip path={path} name={name} size={size} broken={failed && kind === "file"} />;
  if (kind === "image") return <MediaImage path={path} name={name} size={size} alt={alt} />;
  if (kind === "video")
    return (
      <video className="media__video" src={mediaUrl(path)} controls preload="metadata" playsInline aria-label={displayName(name)} onError={() => setFailed(true)}>
        <FileChip path={path} name={name} size={size} />
      </video>
    );
  return (
    <span className="media__audio">
      <span className="media__audio-name">{displayName(name)}</span>
      <audio src={mediaUrl(path)} controls preload="metadata" aria-label={displayName(name)} onError={() => setFailed(true)} />
    </span>
  );
}

/** An image; click it for the full size. */
function MediaImage({ path, name, size, alt }: { path: string; name: string; size?: number; alt?: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <FileChip path={path} name={name} size={size} />;
  return (
    <>
      <button type="button" className="media__image" onClick={() => setOpen(true)} aria-label={`Open ${displayName(name)}`} title={displayName(name)}>
        <img src={mediaUrl(path)} alt={alt || displayName(name)} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </button>
      {open && (
        <Lightbox name={displayName(name)} href={mediaUrl(path)} onClose={() => setOpen(false)}>
          <img src={mediaUrl(path)} alt={alt || displayName(name)} />
        </Lightbox>
      )}
    </>
  );
}

function Lightbox({ name, href, onClose, children }: { name: string; href: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={onClose}>
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox__name">{name}</span>
        <a className="lightbox__btn" href={href} target="_blank" rel="noreferrer">
          Open original
        </a>
        <button className="lightbox__btn" type="button" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="lightbox__body">{children}</div>
    </div>,
    document.body,
  );
}

/** A file the browser does not show: name, size, opens or downloads it. */
export function FileChip({ path, name, size, broken = false }: { path: string; name: string; size?: number; broken?: boolean }) {
  const shown = displayName(name);
  const ext = /\.([^.]{1,5})$/.exec(shown)?.[1]?.toUpperCase() ?? "FILE";
  return (
    <a className={`filechip${broken ? " filechip--broken" : ""}`} href={mediaUrl(path)} target="_blank" rel="noreferrer" title={path}>
      <span className="filechip__icon" aria-hidden>
        {ext}
      </span>
      <span className="filechip__text">
        <span className="filechip__name">{shown}</span>
        <span className="filechip__meta">{size !== undefined ? formatSize(size) : "Open"}</span>
      </span>
    </a>
  );
}
