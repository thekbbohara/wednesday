import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { assistantEnv } from './env.ts'

/** WEDNESDAY_SECRETS_DIR moves keys.json (tests, other installs). */
export const secretDir = () => assistantEnv('SECRETS_DIR') || join(homedir(), '.jarvis/secrets')
export const DEFAULT_VOICES = { wednesday: 'hdMatxlN8izOcIZg4lWv', owner: '3rO5MZtlLioktJaGDGLU' }
export interface KeyData { keys: Record<string, string>; voices: typeof DEFAULT_VOICES; telegramVoice: boolean }
/** A validation message that is safe to show: it never contains the submitted key. */
export class KeyError extends Error {}

export class KeyStore {
  readonly dir: string
  constructor(dir = secretDir()) { this.dir = dir }
  read(): KeyData {
    const path = join(this.dir, 'keys.json')
    let data: Partial<KeyData> = {}
    try { if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8')) }
    catch { throw new Error('keys.json is unreadable.') }
    return { keys: data.keys ?? {}, voices: { ...DEFAULT_VOICES, ...data.voices }, telegramVoice: data.telegramVoice === true }
  }
  key(provider: string): string | undefined {
    const saved = this.read().keys[provider]
    if (saved || provider !== 'elevenlabs') return saved
    const path = join(this.dir, 'elevenlabs.env')
    if (!existsSync(path)) return undefined
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?(?:ELEVENLABS_API_KEY|ELEVENLABS_KEY|XI_API_KEY)\s*=\s*(.*?)\s*$/.exec(line)
      if (match) return match[1].replace(/^(['"])(.*)\1$/, '$2') || undefined
    }
    return undefined
  }
  view() {
    const data = this.read()
    const providers = [...new Set(['elevenlabs', 'openrouter', ...Object.keys(data.keys)])]
    return {
      providers: providers.map(id => {
        const key = this.key(id)
        return { id, saved: !!key, masked: key ? `••••${key.slice(-4)}` : '', source: data.keys[id] ? 'keys.json' : key ? 'elevenlabs.env' : '' }
      }),
      voices: data.voices,
      telegramVoice: data.telegramVoice,
    }
  }
  save(patch: { provider?: unknown; key?: unknown; remove?: unknown; voices?: unknown; telegramVoice?: unknown }) {
    const data = this.read()
    const validProvider = typeof patch.provider === 'string' && /^[a-z][a-z0-9_-]{0,40}$/.test(patch.provider)
    if (patch.remove === true) {
      if (!validProvider) throw new KeyError('Unknown provider.')
      delete data.keys[patch.provider as string]
    } else if (patch.key !== undefined) {
      const key = typeof patch.key === 'string' ? patch.key.trim() : ''
      if (!validProvider || key.length < 8 || key.length > 4096 || /\s/.test(key)) throw new KeyError('Enter a provider id and a valid key.')
      data.keys[patch.provider as string] = key
    }
    if (patch.voices !== undefined) {
      if (!patch.voices || typeof patch.voices !== 'object') throw new KeyError('Invalid voice IDs.')
      for (const id of ['wednesday', 'owner'] as const) {
        const value = (patch.voices as Record<string, unknown>)[id]
        if (typeof value !== 'string' || !/^[a-zA-Z0-9]{10,64}$/.test(value)) throw new KeyError('Voice IDs must be 10-64 letters or digits.')
        data.voices[id] = value
      }
    }
    if (patch.telegramVoice !== undefined) {
      if (typeof patch.telegramVoice !== 'boolean') throw new KeyError('Invalid voice toggle.')
      data.telegramVoice = patch.telegramVoice
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 }); chmodSync(this.dir, 0o700)
    const tmp = join(this.dir, `keys.${randomUUID()}.tmp`)
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flush: true })
    renameSync(tmp, join(this.dir, 'keys.json')); chmodSync(join(this.dir, 'keys.json'), 0o600)
    return this.view()
  }
}

const isLoopback = (url: string) => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) } catch { return false }
}

export function keysApi(store = new KeyStore(), request = fetch) {
  const app = new Hono()
  // Host validation blocks remote hosts and DNS rebinding; Origin validation blocks browser CSRF.
  app.use('*', async (c, next) => {
    if (!isLoopback(c.req.url)) return c.json({ error: 'Localhost only.' }, 403)
    const origin = c.req.header('origin')
    if (origin && !isLoopback(origin)) return c.json({ error: 'Same-origin requests only.' }, 403)
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/', c => {
    try { return c.json(store.view()) }
    catch { return c.json({ error: 'Could not read saved keys. Check keys.json in the secrets folder.' }, 500) }
  })
  app.put('/', async c => {
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON required.' }, 415)
    if (Number(c.req.header('content-length')) > 8192) return c.json({ error: 'Request too large.' }, 413)
    try { return c.json(store.save(await c.req.json())) }
    catch (e) { return c.json({ error: e instanceof KeyError ? e.message : 'Could not save. Check the secrets folder permissions.' }, 400) }
  })
  app.post('/:provider/test', async c => {
    if (c.req.param('provider') !== 'elevenlabs') return c.json({ ok: false, message: 'Testing is supported for ElevenLabs.' }, 400)
    const key = store.key('elevenlabs')
    if (!key) return c.json({ ok: false, message: 'Save an ElevenLabs key first.' }, 400)
    try {
      const res = await request('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15000) })
      return c.json({ ok: res.ok, message: res.ok ? 'ElevenLabs connection OK.' : `ElevenLabs test failed (HTTP ${res.status}).` }, res.ok ? 200 : 400)
    } catch { return c.json({ ok: false, message: 'ElevenLabs could not be reached.' }, 502) }
  })
  return app
}
