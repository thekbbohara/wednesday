import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { KeyStore } from './api-keys.ts'
import { assistantEnv } from './env.ts'

const exec = promisify(execFile)
const API = 'https://api.elevenlabs.io/v1'
export const MAX_TTS_CHARS = 800
/** Newest first; the first one the account can use wins. */
export const TTS_MODELS = ['eleven_v4', 'eleven_v3']
const SIMILARITY = 0.75
/** eleven_v3 only accepts stability 0, 0.5 or 1 (Creative, Natural, Robust). */
const stabilityFor = (_model: string) => 0.5 // calmer, less breathy delivery (owner L3205: not seductive)

/** A failure safe to show or log: never contains the key. */
export class TtsError extends Error {}

export const ttsCacheDir = () => join(assistantEnv('DATA_DIR') || join(homedir(), '.jarvis'), 'cache/tts')

export async function mp3ToOgg(mp3: string, ogg: string) {
  await exec('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', mp3, '-c:a', 'libopus', '-b:a', '48k', '-ac', '1', '-ar', '48000', '-application', 'voip', '-f', 'ogg', ogg], { timeout: 60_000 })
}

export interface SpeechOptions {
  store?: KeyStore
  cacheDir?: string
  request?: typeof fetch
  convert?: (mp3: string, ogg: string) => Promise<void>
  log?: (line: string) => void
}

/** ElevenLabs text-to-speech in Wednesday's voice, as Telegram-ready OGG/Opus, cached by text hash. */
export class Speech {
  readonly store: KeyStore
  readonly cacheDir: string
  private request: typeof fetch
  private convert: (mp3: string, ogg: string) => Promise<void>
  private log: (line: string) => void
  private models = new Map<string, Promise<string>>()
  private pending = new Map<string, Promise<string>>()

  constructor(opts: SpeechOptions = {}) {
    this.store = opts.store ?? new KeyStore()
    this.cacheDir = opts.cacheDir ?? ttsCacheDir()
    this.request = opts.request ?? fetch
    this.convert = opts.convert ?? mp3ToOgg
    this.log = opts.log ?? ((line) => console.log(line))
  }

  /** True when a key is saved; callers fall back to text otherwise. */
  available() {
    try { return !!this.store.key('elevenlabs') } catch { return false }
  }

  /** The newest model the account offers, looked up once per key. */
  model(key: string): Promise<string> {
    const id = createHash('sha256').update(key).digest('hex')
    let found = this.models.get(id)
    if (!found) {
      found = (async () => {
        const res = await this.request(`${API}/models`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15_000) })
        if (!res.ok) throw new TtsError(`ElevenLabs model lookup failed (HTTP ${res.status}).`)
        const models = (await res.json()) as { model_id: string; can_do_text_to_speech?: boolean }[]
        const usable = new Set(models.filter((m) => m.can_do_text_to_speech !== false).map((m) => m.model_id))
        return TTS_MODELS.find((m) => usable.has(m)) ?? TTS_MODELS[TTS_MODELS.length - 1]
      })()
      this.models.set(id, found)
      found.catch(() => this.models.delete(id))
    }
    return found
  }

  /** Synthesizes text (audio tags like [laughs] pass through) and returns the cached .ogg path. */
  async speak(text: string): Promise<string> {
    const clean = text.trim()
    const chars = [...clean].length
    if (!chars) throw new TtsError('Nothing to say.')
    if (chars > MAX_TTS_CHARS) throw new TtsError(`Too long for a voice reply (${chars} > ${MAX_TTS_CHARS} characters).`)
    let key: string | undefined, voice: string
    try {
      key = this.store.key('elevenlabs')
      voice = this.store.read().voices.wednesday
    } catch { throw new TtsError('Saved keys are unreadable.') }
    if (!key) throw new TtsError('No ElevenLabs key saved. Add one in Settings > API keys.')
    const model = await this.model(key)
    const hash = createHash('sha256').update(JSON.stringify({ text: clean, voice, model, stability: stabilityFor(model), similarity: SIMILARITY })).digest('hex')
    const dest = join(this.cacheDir, `${hash}.ogg`)
    if (existsSync(dest)) {
      this.usage({ chars: 0, cached: true, model })
      return dest
    }
    let work = this.pending.get(hash)
    if (!work) {
      work = this.generate(clean, chars, voice, model, key, dest).finally(() => this.pending.delete(hash))
      this.pending.set(hash, work)
    }
    return work
  }

  private async generate(text: string, chars: number, voice: string, model: string, key: string, dest: string) {
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 })
    const stem = join(this.cacheDir, `.${randomUUID()}`)
    const mp3 = `${stem}.mp3`, ogg = `${stem}.ogg`
    try {
      let res: Response
      try {
        res = await this.request(`${API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: model, voice_settings: { stability: stabilityFor(model), similarity_boost: SIMILARITY } }),
          signal: AbortSignal.timeout(90_000),
        })
      } catch { throw new TtsError('ElevenLabs could not be reached.') }
      if (!res.ok) throw new TtsError(`ElevenLabs text-to-speech failed (HTTP ${res.status}).`)
      writeFileSync(mp3, Buffer.from(await res.arrayBuffer()), { mode: 0o600 })
      this.usage({ chars, cached: false, model })
      try { await this.convert(mp3, ogg) } catch { throw new TtsError('ffmpeg could not convert the audio to OGG/Opus.') }
      chmodSync(ogg, 0o600)
      renameSync(ogg, dest)
      return dest
    } finally {
      rmSync(mp3, { force: true })
      rmSync(ogg, { force: true })
    }
  }

  /** Characters billed, one line per call: console plus <cache>/usage.jsonl. */
  private usage(entry: { chars: number; cached: boolean; model: string }) {
    this.log(`tts: ${entry.cached ? 'cache hit' : `${entry.chars} characters`} (${entry.model})`)
    try {
      mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 })
      appendFileSync(join(this.cacheDir, 'usage.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 })
    } catch { /* usage log is best effort */ }
  }
}

/** POST /api/tts {text} -> audio/ogg. Loopback only, like the keys API. */
export function ttsApi(speech = new Speech()) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) return c.json({ error: 'Localhost only.' }, 403)
    if (c.req.header('origin')) return c.json({ error: 'Not for browsers.' }, 403)
    await next()
  })
  app.get('/', (c) => c.json({ available: speech.available(), maxChars: MAX_TTS_CHARS }))
  app.post('/', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
    if (typeof body?.text !== 'string') return c.json({ error: 'Send {"text": "..."}.' }, 400)
    try {
      const path = await speech.speak(body.text)
      return c.body(await readFile(path), 200, { 'content-type': 'audio/ogg', 'cache-control': 'no-store' })
    } catch (e) {
      return c.json({ error: e instanceof TtsError ? e.message : 'Text-to-speech failed.' }, e instanceof TtsError ? 422 : 500)
    }
  })
  return app
}

// CLI: node src/tts.ts "Hello [laughs] there" [out.ogg]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [text, out] = process.argv.slice(2)
  if (!text) {
    console.error('usage: node src/tts.ts "text to say" [out.ogg]')
    process.exit(2)
  }
  new Speech({ log: (line) => console.error(line) }).speak(text).then(
    (path) => {
      if (out) copyFileSync(path, out)
      console.log(out ? resolve(out) : path)
    },
    (e) => {
      console.error(e instanceof TtsError ? e.message : 'Text-to-speech failed.')
      process.exit(1)
    },
  )
}
