import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_VOICES, KeyStore, keysApi } from '../src/api-keys.ts'

const KEY = 'sk_test_0123456789abcdWXYZ'
const base = 'http://127.0.0.1:4799'
const put = (app: ReturnType<typeof keysApi>, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`${base}/`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('API keys', () => {
  it('stores keys at 600 and never returns them', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'keys-')), 'secrets')
    const app = keysApi(new KeyStore(dir))
    const res = await put(app, { provider: 'elevenlabs', key: `  ${KEY}\n` })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(KEY.slice(0, -4))
    expect(JSON.parse(text).providers[0]).toEqual({ id: 'elevenlabs', saved: true, masked: '••••WXYZ', source: 'keys.json' })
    expect(statSync(join(dir, 'keys.json')).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(JSON.parse(readFileSync(join(dir, 'keys.json'), 'utf8')).keys.elevenlabs).toBe(KEY)
    const view = await (await app.request(`${base}/`)).text()
    expect(view).not.toContain(KEY.slice(0, -4))
    expect(JSON.parse(view).voices).toEqual(DEFAULT_VOICES)
  })

  it('adds and removes other providers, validates voices and toggle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'))
    const app = keysApi(new KeyStore(dir))
    const added: any = await (await put(app, { provider: 'groq', key: 'gsk_abcdefgh1234' })).json()
    expect(added.providers.map((p: { id: string }) => p.id)).toEqual(['elevenlabs', 'openrouter', 'groq'])
    const removed: any = await (await put(app, { provider: 'groq', remove: true })).json()
    expect(removed.providers.map((p: { id: string }) => p.id)).toEqual(['elevenlabs', 'openrouter'])
    const bad = await put(app, { provider: 'groq', key: 'secret with spaces inside' })
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain('secret')
    expect((await put(app, { voices: { ...DEFAULT_VOICES, owner: 'x' } })).status).toBe(400)
    const voice: any = await (await put(app, { voices: { ...DEFAULT_VOICES, owner: 'abcdefghij12' }, telegramVoice: true })).json()
    expect(voice.voices.owner).toBe('abcdefghij12')
    expect(voice.telegramVoice).toBe(true)
  })

  it('falls back to elevenlabs.env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'))
    writeFileSync(join(dir, 'elevenlabs.env'), `# comment\nexport ELEVENLABS_API_KEY="${KEY}"\n`)
    const store = new KeyStore(dir)
    expect(store.key('elevenlabs')).toBe(KEY)
    expect(store.view().providers[0]).toMatchObject({ saved: true, masked: '••••WXYZ', source: 'elevenlabs.env' })
  })

  it('rejects remote hosts and cross-site origins', async () => {
    const app = keysApi(new KeyStore(mkdtempSync(join(tmpdir(), 'keys-'))))
    expect((await app.request('http://evil.example/')).status).toBe(403)
    expect((await put(app, { provider: 'openrouter', key: KEY }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await put(app, { provider: 'openrouter', key: KEY }, { origin: 'http://localhost:5788' })).status).toBe(200)
  })

  it('tests ElevenLabs with the saved key and reports failures without the key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'))
    const seen: string[] = []
    const fake = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>)['xi-api-key']}`)
      return new Response('{}', { status: seen.length === 1 ? 200 : 401 })
    }) as typeof fetch
    const app = keysApi(new KeyStore(dir), fake)
    expect((await app.request(`${base}/elevenlabs/test`, { method: 'POST' })).status).toBe(400)
    await put(app, { provider: 'elevenlabs', key: KEY })
    expect(await (await app.request(`${base}/elevenlabs/test`, { method: 'POST' })).json()).toEqual({ ok: true, message: 'ElevenLabs connection OK.' })
    const failed = await app.request(`${base}/elevenlabs/test`, { method: 'POST' })
    expect(await failed.json()).toEqual({ ok: false, message: 'ElevenLabs test failed (HTTP 401).' })
    expect(seen).toEqual([`https://api.elevenlabs.io/v1/user ${KEY}`, `https://api.elevenlabs.io/v1/user ${KEY}`])
  })

  it('reports an unreadable keys.json instead of crashing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'))
    writeFileSync(join(dir, 'keys.json'), '{nope')
    const res = await keysApi(new KeyStore(dir)).request(`${base}/`)
    expect(res.status).toBe(500)
  })
})
