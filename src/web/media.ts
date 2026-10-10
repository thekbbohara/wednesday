// Files in the chat: what the owner uploads (saved to <data>/inbox/web) and
// local files a message names (shown inline). Reading goes through
// MediaRoots, the only gate between the web and the disk: real paths only,
// inside the allowed roots, no hidden or secret files.
import { createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { assistantEnv } from '../env.ts'

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

/** A local file a message shows: an image, a player, or a download chip. */
export interface MediaRef {
  /** Absolute path, as the message names it (also what /api/media takes). */
  path: string
  name: string
  size: number
  kind: MediaKind
  mime: string
}

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  zip: 'application/zip',
}

/** Types a browser may show in place; everything else is sent as a download. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon)|video\/(mp4|webm|ogg|quicktime)|audio\/|application\/pdf|text\/plain)/

export function mimeOf(path: string): string {
  return TYPES[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

export function kindOf(mime: string): MediaKind {
  // Containers the browser cannot play (mkv, heic) still count, so they get a player or an image box with a fallback.
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

// ---- uploads ---------------------------------------------------------------------------

/**
 * The file name with anything risky replaced: no directories, no "..", no
 * leading dots, letters of any script kept (the Telegram inbox rule, plus a
 * byte cap so the stamped name fits every filesystem).
 */
export function safeName(name: string): string {
  const base = basename(String(name).replace(/\\/g, '/')).normalize('NFC')
  const cleaned = base.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_').replace(/_+/g, '_').replace(/^[._]+/, '')
  const ext = /\.[\p{L}\p{N}]{1,10}$/u.exec(cleaned)?.[0] ?? ''
  let stem = cleaned.slice(0, cleaned.length - ext.length)
  while (Buffer.byteLength(stem + ext) > 180) stem = Array.from(stem).slice(0, -1).join('')
  return stem.replace(/[._]+$/, '') ? `${stem}${ext}` : ext ? `file${ext}` : 'file'
}

/** 20260101-120000 (UTC), as the Telegram inbox names files. */
export function stampOf(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
}

export class UploadError extends Error {
  readonly status: 400 | 413 | 500
  constructor(message: string, status: 400 | 413 | 500) {
    super(message)
    this.status = status
  }
}

/**
 * Streams one upload to <dir>/<stamp>-<safe name>, never holding it in memory.
 * The bytes land in a hidden .part file first and are linked into place only
 * when complete, so a cut-off upload leaves nothing behind and an existing
 * file is never overwritten (a clash gets -2, -3, ...).
 */
export async function saveUpload(dir: string, name: string, body: ReadableStream<Uint8Array> | Readable, maxBytes: number, now = new Date()): Promise<{ path: string; size: number }> {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.${randomUUID()}.part`)
  let size = 0
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      if (size > maxBytes) done(new UploadError(`file is over ${Math.floor(maxBytes / 1024 / 1024)} MB`, 413))
      else done(null, chunk)
    },
  })
  try {
    const source = body instanceof Readable ? body : Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>)
    await pipeline(source, count, createWriteStream(tmp, { flags: 'wx', mode: 0o600 }))
    const file = `${stampOf(now)}-${safeName(name)}`
    const ext = extname(file)
    const stem = file.slice(0, file.length - ext.length)
    for (let n = 1; ; n++) {
      const dest = join(dir, n === 1 ? file : `${stem}-${n}${ext}`)
      try {
        linkSync(tmp, dest)
        return { path: dest, size }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n > 999) throw e
      }
    }
  } catch (e) {
    if (e instanceof UploadError) throw e
    throw new UploadError(`upload failed: ${(e as Error).message}`, 500)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {}
  }
}

/** "a photo", "a video", "a file (report.pdf)", for the note the captain reads. */
export function describeUpload(path: string): string {
  const kind = kindOf(mimeOf(path))
  if (kind === 'image') return 'a photo'
  if (kind === 'video') return 'a video'
  if (kind === 'audio') return 'an audio file'
  return `a file (${basename(path).replace(/^\d{8}-\d{6}-/, '')})`
}

/** The line the captain gets per attachment, in the Telegram gateway's style. */
export function uploadNote(path: string): string {
  return `(Web: I attached ${describeUpload(path)}. Saved at ${path})`
}

const NOTE = /^\(Web: I attached .+?\. Saved at (\/\S+)\)$/

/** The owner's words and the attachment paths of a message the web chat sent. */
export function splitNotes(text: string): { text: string; paths: string[] } {
  const paths: string[] = []
  const kept = text.split('\n').filter((line) => {
    const m = NOTE.exec(line)
    if (m) paths.push(m[1])
    return !m
  })
  return { text: kept.join('\n').trim(), paths }
}

// ---- reading ---------------------------------------------------------------------------

export class MediaError extends Error {
  readonly status: 400 | 403 | 404
  constructor(message: string, status: 400 | 403 | 404) {
    super(message)
    this.status = status
  }
}

/** Names never served, wherever they are: keys, env files, private keys. */
const SECRET_NAME = /(^|\.)env$|\.(pem|key|p12|pfx|kdbx)$|^id_(rsa|dsa|ecdsa|ed25519)|^(credentials|auth|token)s?\.json$/i

/**
 * The allowed roots. A path is readable when its real path (symlinks
 * resolved) is a regular file inside a root, with no hidden folder or file
 * below that root (so ~/.ssh stays out even though ~ is a root; the data dir
 * is its own root), and is not a secret.
 */
export class MediaRoots {
  readonly roots: string[]
  private readonly denied: string[]
  readonly home: string

  constructor(roots: string[], opts: { denied?: string[]; home?: string } = {}) {
    this.home = opts.home ?? homedir()
    this.roots = [...new Set(roots.filter((r) => isAbsolute(r) && existsSync(r)).map((r) => realpathSync(r)))]
    this.denied = (opts.denied ?? []).filter((d) => existsSync(d)).map((d) => realpathSync(d))
  }

  /**
   * The owner's home and the data dir (WEDNESDAY_MEDIA_ROOTS, colon separated,
   * replaces them; <data>/inbox always stays). Folders the owner linked into a root's top level
   * (~/Downloads -> /mnt/data/Downloads) count as part of it; deeper links
   * that leave the roots do not. Secrets, hooks and databases in the data dir
   * stay out.
   */
  static forData(dataDir: string, env = assistantEnv('MEDIA_ROOTS'), home = homedir()): MediaRoots {
    const base = env?.trim() ? env.split(':').map((r) => expandHome(r.trim(), home)).filter(Boolean) : [home, dataDir]
    // The inbox (web and Telegram uploads) always shows, whatever the roots.
    const roots = [...base, join(dataDir, 'inbox')].flatMap((r) => [r, ...linkedFolders(r)])
    const denied = ['secrets', 'hooks', 'memory.db', 'memory.db-wal', 'memory.db-shm', 'memory-vec.db', 'memory-pages.db', 'memory.db.bak-v2'].map((f) => join(dataDir, f))
    return new MediaRoots(roots, { denied, home })
  }

  /** "/abs", "~/x" or "file:///abs" -> the absolute path, or null when it is none of those. */
  toPath(input: string): string | null {
    let p = String(input).trim()
    if (!p || p.includes('\0')) return null
    if (/^file:\/\//i.test(p)) {
      try {
        p = fileURLToPath(p)
      } catch {
        return null
      }
    } else p = expandHome(p, this.home)
    return isAbsolute(p) ? normalize(p) : null
  }

  /** The real path and stats of a readable file, or a MediaError saying why not. */
  resolve(input: string): { real: string; stat: Stats } {
    const path = this.toPath(input)
    if (!path) throw new MediaError('not an absolute path', 400)
    let real: string
    try {
      real = realpathSync(path)
    } catch {
      throw new MediaError('no such file', 404)
    }
    if (!this.allows(real)) throw new MediaError('outside the allowed folders', 403)
    const stat = statSync(real)
    if (!stat.isFile()) throw new MediaError('not a file', 404)
    return { real, stat }
  }

  private allows(real: string): boolean {
    if (SECRET_NAME.test(basename(real))) return false
    if (this.denied.some((d) => real === d || real.startsWith(d + sep))) return false
    return this.roots.some((root) => {
      if (real !== root && !real.startsWith(root === sep ? root : root + sep)) return false
      return !relative(root, real).split(sep).some((part) => part.startsWith('.'))
    })
  }

  /** The files a message names that can be shown, at most `limit`, each once. */
  refs(text: string, limit = 12): MediaRef[] {
    const out: MediaRef[] = []
    const seen = new Set<string>()
    for (const c of candidates(text)) {
      if (out.length >= limit) break
      const path = this.toPath(c)
      if (!path) continue
      try {
        const { real, stat } = this.resolve(path)
        if (seen.has(real)) continue
        seen.add(real)
        const mime = mimeOf(real)
        out.push({ path, name: basename(path), size: stat.size, kind: kindOf(mime), mime })
      } catch {}
    }
    return out
  }
}

/** Directories that a root's visible top-level symlinks point at. */
function linkedFolders(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isSymbolicLink() && !d.name.startsWith('.'))
      .map((d) => join(root, d.name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

export function expandHome(p: string, home = homedir()): string {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p
}

/**
 * Local paths a message names: file:// URLs, absolute and ~/ paths, in text,
 * `code` and markdown links. Fenced code blocks and markdown images are
 * left out (an image renders where it is written).
 */
export function candidates(text: string): string[] {
  let fence = ''
  const prose = text.split('\n').filter((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (m && (!fence || m[1].startsWith(fence))) {
      fence = fence ? '' : m[1]
      return false
    }
    return !fence
  })
  const body = prose.join('\n').replace(/!\[[^\]]*\]\(\s*(<[^>\n]*>|[^)\s]*)[^)]*\)/g, ' ')
  const out: string[] = []
  // Inline code holding exactly one path, spaces allowed: `~/My Files/a.png`.
  for (const m of body.matchAll(/`((?:file:\/\/|~\/|\/)[^`\n]+)`/g)) out.push(m[1].trim())
  for (const m of body.matchAll(/\]\(\s*<((?:file:\/\/|~\/|\/)[^>\n]+)>\s*\)/g)) out.push(m[1])
  const rest = body.replace(/`(?:file:\/\/|~\/|\/)[^`\n]+`|\]\(\s*<[^>\n]+>\s*\)/g, ' ')
  for (const m of rest.matchAll(/(?:^|[\s(\[<"'`*_])((?:file:\/\/\/|~\/|\/)[^\s)\]>"'`*,;]+)/g)) {
    // A URL's path ("https://x.com/a") never starts after whitespace, so it is not matched; strip trailing punctuation.
    out.push(m[1].replace(/[.:!?]+$/, ''))
  }
  return [...new Set(out)].filter((p) => p !== '/' && !/^\/\//.test(p))
}

// ---- serving ---------------------------------------------------------------------------

/**
 * The most an open-ended range ("bytes=N-") gets in one response. A browser
 * opens such a request for every video on the page and holds it open; with
 * whole-file answers a few videos use up its six connections per host and a
 * seek waits forever. Bounded answers finish, and the player asks for more.
 */
export const RANGE_CHUNK = 2 * 1024 * 1024

/** "bytes=a-b" against a size: the range, null for the whole file, or "unsatisfiable". `chunk` caps open-ended ranges. */
export function parseRange(header: string | undefined, size: number, chunk = Infinity): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null
  const m = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/.exec(header.trim())
  // Several ranges or another unit: answer with the whole file, which RFC 9110 allows.
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    const n = Number(m[2])
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? Math.min(size - 1, start + chunk - 1) : Math.min(Number(m[2]), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}

/** The response for GET/HEAD /api/media: the file, a 206 slice of it, or 304. */
export function mediaResponse(real: string, stat: Stats, req: { range?: string; ifNoneMatch?: string; download?: boolean; head?: boolean }): Response {
  const size = stat.size
  const mime = mimeOf(real)
  const inline = !req.download && INLINE.test(mime)
  const etag = `"${stat.ino.toString(36)}-${size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`
  const headers = new Headers({
    'content-type': inline ? mime : 'application/octet-stream',
    'accept-ranges': 'bytes',
    etag,
    'last-modified': stat.mtime.toUTCString(),
    'cache-control': 'private, no-cache',
    'x-content-type-options': 'nosniff',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(basename(real))}`,
    // Opened on its own, a file (an SVG, a text file) runs no script with the chat's sign-in. Chrome shows no PDF under a sandbox, and PDFs run none here.
    ...(mime === 'application/pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'" }),
  })
  if (req.ifNoneMatch && req.ifNoneMatch.split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers })
  const range = parseRange(req.range, size, RANGE_CHUNK)
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  headers.set('content-length', String(Math.max(0, end - start + 1)))
  if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`)
  const status = range ? 206 : 200
  if (req.head || size === 0) return new Response(null, { status, headers })
  const stream = Readable.toWeb(createReadStream(real, { start, end })) as ReadableStream<Uint8Array>
  return new Response(stream, { status, headers })
}

/** Where the web chat saves uploads: <real data dir>/inbox/web. */
export function webInbox(dataDir: string): string {
  return join(existsSync(dataDir) ? realpathSync(dataDir) : dataDir, 'inbox', 'web')
}

/** The real path of an upload: a visible file directly in `dir`, else null. Attaching and removing go by this path only. */
export function inboxFile(dir: string, path: unknown): string | null {
  if (typeof path !== 'string' || !isAbsolute(path)) return null
  try {
    const real = realpathSync(path)
    return dirname(real) === realpathSync(dir) && !basename(real).startsWith('.') && statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}
