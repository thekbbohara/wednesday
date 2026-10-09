import { describe, it, expect } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyStore } from '../src/api-keys.ts'
import { MAX_TTS_CHARS, Speech, TtsError, ttsApi } from '../src/tts.ts'

const KEY = 'sk_test_0123456789abcdWXYZ'

function setup(models = ['eleven_v4', 'eleven_v3'], ttsStatus = 200) {
  const dir = mkdtempSync(join(tmpdir(), 'tts-'))
  const store = new KeyStore(join(dir, 'secrets'))
  const calls: { url: string; body?: any }[] = []
  const logs: string[] = []
  const request = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/models')) return Response.json(models.map((model_id) => ({ model_id, can_do_text_to_speech: true })))
    return new Response(ttsStatus === 200 ? 'mp3-bytes' : 'nope', { status: ttsStatus })
  }) as typeof fetch
  const convert = async (mp3: string, ogg: string) => copyFileSync(mp3, ogg)
  const speech = new Speech({ store, cacheDir: join(dir, 'cache'), request, convert, log: (l) => logs.push(l) })
  return { dir, store, speech, calls, logs }
}

describe('Speech', () => {
  it('fails gracefully without a key', async () => {
    const { speech, calls } = setup()
    expect(speech.available()).toBe(false)
    await expect(speech.speak('hi')).rejects.toThrow(/No ElevenLabs key/)
    expect(calls).toEqual([])
  })

  it('uses eleven_v4 with Wednesday voice, keeps audio tags, caches by text', async () => {
    const { store, speech, calls, logs, dir } = setup()
    store.save({ provider: 'elevenlabs', key: KEY })
    const path = await speech.speak('[whispers] Hello there.')
    expect(readFileSync(path, 'utf8')).toBe('mp3-bytes')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const tts = calls.find((c) => c.url.includes('/text-to-speech/'))!
    expect(tts.url).toContain('/text-to-speech/hdMatxlN8izOcIZg4lWv?')
    expect(tts.body).toEqual({ text: '[whispers] Hello there.', model_id: 'eleven_v4', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    expect(await speech.speak('[whispers] Hello there.')).toBe(path)
    expect(calls.filter((c) => c.url.includes('/text-to-speech/'))).toHaveLength(1)
    expect(calls.filter((c) => c.url.endsWith('/models'))).toHaveLength(1)
    expect(logs.join('\n')).not.toContain(KEY)
    const usage = readFileSync(join(dir, 'cache/usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(usage.map((u) => [u.chars, u.cached])).toEqual([[23, false], [0, true]])
  })

  it('falls back to eleven_v3 with its fixed stability', async () => {
    const { store, speech, calls } = setup(['eleven_multilingual_v2', 'eleven_v3'])
    store.save({ provider: 'elevenlabs', key: KEY })
    await speech.speak('Hi')
    expect(calls.at(-1)!.body).toMatchObject({ model_id: 'eleven_v3', voice_settings: { stability: 0.5 } })
  })

  it('caps length and reports HTTP failures without the key', async () => {
    const { store, speech } = setup(undefined, 401)
    store.save({ provider: 'elevenlabs', key: KEY })
    await expect(speech.speak('x'.repeat(MAX_TTS_CHARS + 1))).rejects.toThrow(/Too long/)
    const err = await speech.speak('Hi').catch((e) => e)
    expect(err).toBeInstanceOf(TtsError)
    expect(err.message).toBe('ElevenLabs text-to-speech failed (HTTP 401).')
  })

  it('serves audio over the loopback endpoint', async () => {
    const { store, speech } = setup()
    const app = ttsApi(speech)
    expect((await (await app.request('http://127.0.0.1/', { method: 'POST', body: JSON.stringify({ text: 'Hi' }), headers: { 'content-type': 'application/json' } })).json())).toEqual({ error: 'No ElevenLabs key saved. Add one in Settings > API keys.' })
    store.save({ provider: 'elevenlabs', key: KEY })
    const res = await app.request('http://127.0.0.1/', { method: 'POST', body: JSON.stringify({ text: 'Hi' }), headers: { 'content-type': 'application/json' } })
    expect(res.headers.get('content-type')).toBe('audio/ogg')
    expect(await res.text()).toBe('mp3-bytes')
    expect((await app.request('http://evil.example/')).status).toBe(403)
    expect((await app.request('http://127.0.0.1/', { method: 'POST', headers: { origin: 'http://127.0.0.1' } })).status).toBe(403)
  })
})
