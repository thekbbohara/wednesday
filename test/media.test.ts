import { describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { loadConfig } from '../src/config.ts'
import { Memory } from '../src/memory/store.ts'
import { createApp, loopbackHost } from '../src/server.ts'
import { candidates, MediaRoots, parseRange, RANGE_CHUNK, safeName, saveUpload, splitNotes, stampOf, uploadNote, webInbox } from '../src/web/media.ts'
import type { Runner, TurnRequest, TurnResult } from '../src/captain/runner.ts'

const tmp = (p = 'wed-media-') => realpathSync(mkdtempSync(join(tmpdir(), p)))

describe('upload names', () => {
  it('keeps unicode, drops directories, traversal and leading dots', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd')
    expect(safeName('..\\..\\windows\\evil.exe')).toBe('evil.exe')
    expect(safeName('.bashrc')).toBe('bashrc')
    expect(safeName('...')).toBe('file')
    expect(safeName('')).toBe('file')
    expect(safeName('मेरी फ़ोटो 1.jpg')).toBe('मेरी_फ़ोटो_1.jpg')
    expect(safeName('café menu (final).PDF')).toBe('café_menu_final_.PDF')
    expect(safeName('a\0b/c\nd.png')).toBe('c_d.png')
    expect(safeName('.png')).toBe('png')
    expect(Buffer.byteLength(safeName(`${'ü'.repeat(400)}.mp4`))).toBeLessThanOrEqual(180)
    expect(safeName(`${'ü'.repeat(400)}.mp4`)).toMatch(/^ü+\.mp4$/)
  })

  it('stamps like the Telegram inbox', () => {
    expect(stampOf(new Date('2026-10-10T07:05:09Z'))).toBe('20261010-070509')
  })

  it('streams to <stamp>-<name>, never overwrites, leaves no partial files', async () => {
    const dir = join(tmp(), 'inbox', 'web')
    const now = new Date('2026-10-10T07:05:09Z')
    const a = await saveUpload(dir, '../x.png', Readable.from([Buffer.from('one')]), 100, now)
    const b = await saveUpload(dir, 'x.png', Readable.from([Buffer.from('two')]), 100, now)
    expect(a.path).toBe(join(dir, '20261010-070509-x.png'))
    expect(b.path).toBe(join(dir, '20261010-070509-x-2.png'))
    expect(readFileSync(a.path, 'utf8')).toBe('one')
    expect(b.size).toBe(3)
    await expect(saveUpload(dir, 'big.bin', Readable.from([Buffer.alloc(60), Buffer.alloc(60)]), 100, now)).rejects.toMatchObject({ status: 413 })
    expect(readdirSync(dir).sort()).toEqual(['20261010-070509-x-2.png', '20261010-070509-x.png'])
  })

  it('writes the captain note and reads it back', () => {
    expect(uploadNote('/d/inbox/web/20261010-070509-x.png')).toBe('(Web: I attached a photo. Saved at /d/inbox/web/20261010-070509-x.png)')
    expect(uploadNote('/d/20261010-070509-clip.mp4')).toBe('(Web: I attached a video. Saved at /d/20261010-070509-clip.mp4)')
    expect(uploadNote('/d/20261010-070509-report.pdf')).toBe('(Web: I attached a file (report.pdf). Saved at /d/20261010-070509-report.pdf)')
    expect(splitNotes(`look\n${uploadNote('/d/a.png')}\n${uploadNote('/d/b.mp4')}`)).toEqual({ text: 'look', paths: ['/d/a.png', '/d/b.mp4'] })
  })
})

describe('paths in messages', () => {
  it('finds absolute, ~/ and file:// paths, not URLs, fenced code or markdown images', () => {
    const text = [
      'Here is /home/me/Downloads/clip.mp4, and `~/Pictures/My Shot.png`.',
      'Also file:///home/me/a%20b.pdf and https://example.com/home/me/x.png',
      '![chart](/home/me/chart.png) [report](/home/me/report.pdf)',
      '```',
      'ls /home/me/secret.txt',
      '```',
    ].join('\n')
    expect(candidates(text)).toEqual(['~/Pictures/My Shot.png', '/home/me/Downloads/clip.mp4', 'file:///home/me/a%20b.pdf', '/home/me/report.pdf'])
  })
})

describe('MediaRoots', () => {
  const setup = () => {
    const base = tmp()
    const home = join(base, 'home')
    const data = join(home, '.wednesday')
    mkdirSync(join(home, 'Downloads'), { recursive: true })
    mkdirSync(join(home, '.ssh'), { recursive: true })
    mkdirSync(join(data, 'secrets'), { recursive: true })
    mkdirSync(join(data, 'inbox', 'web'), { recursive: true })
    writeFileSync(join(base, 'outside.txt'), 'outside')
    writeFileSync(join(home, 'Downloads', 'v.mp4'), 'video')
    writeFileSync(join(home, '.ssh', 'id_ed25519'), 'key')
    writeFileSync(join(home, 'Downloads', 'prod.env'), 'K=V')
    writeFileSync(join(data, 'secrets', 'keys.json'), '{}')
    writeFileSync(join(data, 'memory.db'), 'db')
    writeFileSync(join(data, 'inbox', 'web', 'a.png'), 'png')
    symlinkSync(join(base, 'outside.txt'), join(home, 'Downloads', 'escape.txt'))
    symlinkSync(join(home, '.ssh', 'id_ed25519'), join(home, 'Downloads', 'key.txt'))
    symlinkSync(join(home, 'Downloads', 'v.mp4'), join(home, 'Downloads', 'link.mp4'))
    symlinkSync(base, join(home, 'Downloads', 'up'))
    // ~/Videos -> a data disk, linked by the owner at the top of the home.
    mkdirSync(join(base, 'disk', 'Videos', '.private'), { recursive: true })
    writeFileSync(join(base, 'disk', 'Videos', 'trip.mp4'), 'v')
    writeFileSync(join(base, 'disk', 'Videos', '.private', 'x.mp4'), 'v')
    writeFileSync(join(base, 'disk', 'other.mp4'), 'v')
    symlinkSync(join(base, 'disk', 'Videos'), join(home, 'Videos'))
    symlinkSync(join(base, 'disk', 'other.mp4'), join(base, 'disk', 'Videos', 'sneaky.mp4'))
    symlinkSync(join(base, 'disk'), join(home, '.hiddenlink'))
    const roots = MediaRoots.forData(data, '', home)
    return { base, home, data, roots }
  }
  const status = (roots: MediaRoots, p: string) => {
    try {
      roots.resolve(p)
      return 200
    } catch (e) {
      return (e as { status: number }).status
    }
  }

  it('serves files in the home and data dir, by path, ~/ or file://', () => {
    const { home, data, roots } = setup()
    expect(status(roots, join(home, 'Downloads', 'v.mp4'))).toBe(200)
    expect(status(roots, '~/Downloads/v.mp4')).toBe(200)
    expect(status(roots, `file://${home}/Downloads/v.mp4`)).toBe(200)
    expect(status(roots, join(data, 'inbox', 'web', 'a.png'))).toBe(200)
    expect(status(roots, join(home, 'Downloads', 'link.mp4'))).toBe(200)
    expect(status(roots, '~/Videos/trip.mp4')).toBe(200)
  })

  it('follows a top-level link only to its own folder', () => {
    const { roots } = setup()
    expect(status(roots, '~/Videos/sneaky.mp4')).toBe(403)
    expect(status(roots, '~/Videos/../other.mp4')).toBe(404)
    expect(status(roots, '~/Videos/.private/x.mp4')).toBe(403)
    expect(status(roots, '~/.hiddenlink/other.mp4')).toBe(403)
  })

  it('refuses traversal, symlinks out of the roots, hidden and secret files', () => {
    const { base, home, data, roots } = setup()
    expect(status(roots, `${home}/Downloads/../../outside.txt`)).toBe(403)
    expect(status(roots, '~/../outside.txt')).toBe(403)
    expect(status(roots, join(base, 'outside.txt'))).toBe(403)
    expect(status(roots, join(home, 'Downloads', 'escape.txt'))).toBe(403)
    expect(status(roots, join(home, 'Downloads', 'up', 'outside.txt'))).toBe(403)
    expect(status(roots, join(home, 'Downloads', 'key.txt'))).toBe(403)
    expect(status(roots, join(home, '.ssh', 'id_ed25519'))).toBe(403)
    expect(status(roots, join(home, 'Downloads', 'prod.env'))).toBe(403)
    expect(status(roots, join(data, 'secrets', 'keys.json'))).toBe(403)
    expect(status(roots, join(data, 'memory.db'))).toBe(403)
    expect(status(roots, join(home, 'Downloads'))).toBe(404)
    expect(status(roots, join(home, 'Downloads', 'nope.png'))).toBe(404)
    expect(status(roots, 'Downloads/v.mp4')).toBe(400)
    expect(status(roots, `${home}/Downloads/v.mp4\0.png`)).toBe(400)
    expect(status(roots, 'file://evil.com/etc/passwd')).toBe(400)
  })

  it('keeps the inbox when WEDNESDAY_MEDIA_ROOTS replaces the roots', () => {
    const { base, home, data } = setup()
    const roots = MediaRoots.forData(data, join(base, 'disk'), home)
    expect(status(roots, join(data, 'inbox', 'web', 'a.png'))).toBe(200)
    expect(status(roots, join(home, 'Downloads', 'v.mp4'))).toBe(403)
    expect(status(roots, join(base, 'disk', 'other.mp4'))).toBe(200)
  })

  it('lists the files a message names, each once', () => {
    const { home, roots } = setup()
    const refs = roots.refs(`see ${home}/Downloads/v.mp4 and ~/Downloads/v.mp4 and ${home}/.ssh/id_ed25519 and /nope.png`)
    expect(refs).toEqual([{ path: `${home}/Downloads/v.mp4`, name: 'v.mp4', size: 5, kind: 'video', mime: 'video/mp4' }])
  })
})

describe('ranges', () => {
  it('parses single byte ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=9-3', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
    // Open-ended ranges come back in bounded pieces; explicit ones as asked.
    expect(parseRange('bytes=0-', 100, 30)).toEqual({ start: 0, end: 29 })
    expect(parseRange('bytes=80-', 100, 30)).toEqual({ start: 80, end: 99 })
    expect(parseRange('bytes=0-99', 100, 30)).toEqual({ start: 0, end: 99 })
  })
})

describe('loopback hosts', () => {
  it('accepts localhost and IP literals only', () => {
    for (const h of ['localhost:4788', '127.0.0.1:4788', '[::1]:4788', '192.168.1.5', 'app.localhost']) expect(loopbackHost(h), h).toBe(true)
    for (const h of ['evil.com', 'evil.com:4788', '127.0.0.1.nip.io', undefined]) expect(loopbackHost(h), String(h)).toBe(false)
  })
})

class DoneRunner implements Runner {
  calls: TurnRequest[] = []
  async run(req: TurnRequest): Promise<TurnResult> {
    this.calls.push(req)
    return { text: 'ok', contextTokens: 1000, contextWindow: 200000, costUsd: 0, isError: false }
  }
}

describe('file routes', () => {
  const setup = (token?: string) => {
    const home = tmp('wed-home-')
    const dataDir = join(home, '.wednesday')
    mkdirSync(join(home, 'Downloads'), { recursive: true })
    const video = join(home, 'Downloads', 'clip.mp4')
    writeFileSync(video, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)))
    writeFileSync(join(home, 'Downloads', 'page.html'), '<script>alert(1)</script>')
    writeFileSync(join(home, 'outside.txt'), 'x')
    const cfg = loadConfig({ dataDir })
    mkdirSync(dataDir, { recursive: true })
    const mem = new Memory(cfg.dbPath)
    const runner = new DoneRunner()
    const { app, close } = createApp({ mem, cfg, runner, token, pollMs: 50, media: new MediaRoots([join(home, 'Downloads'), dataDir], { home }), maxUploadBytes: 1 << 20 })
    const headers = { host: 'localhost:4788', ...(token ? { authorization: `Bearer ${token}` } : {}) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Res = Omit<Response, 'json'> & { json(): Promise<any> }
    const req = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } }) as Promise<Res>
    return { home, dataDir, video, mem, runner, req, close }
  }

  it('uploads, attaches, and the captain gets the paths', async () => {
    const { dataDir, req, runner, close } = setup()
    const up = await req('/api/uploads?name=../../Screenshot%201.png', { method: 'POST', body: 'PNGDATA', headers: { 'content-type': 'image/png' } })
    expect(up.status).toBe(200)
    const { file } = await up.json()
    expect(file.path.startsWith(join(webInbox(dataDir), ''))).toBe(true)
    expect(file.name).toMatch(/^\d{8}-\d{6}-Screenshot_1\.png$/)
    expect(file).toMatchObject({ size: 7, kind: 'image', mime: 'image/png' })
    expect(readFileSync(file.path, 'utf8')).toBe('PNGDATA')

    const sent = await req('/api/messages', { method: 'POST', body: JSON.stringify({ text: 'what is this?', attachments: [file.path] }), headers: { 'content-type': 'application/json' } })
    const { item } = await sent.json()
    expect(item).toMatchObject({ type: 'owner', text: 'what is this?', media: [{ path: file.path, kind: 'image' }] })
    for (let i = 0; i < 100 && !runner.calls.length; i++) await new Promise((r) => setTimeout(r, 10))
    expect(runner.calls[0].message).toContain(`what is this?\n(Web: I attached a photo. Saved at ${file.path})`)

    // History keeps the attachment after a reload.
    const page = await (await req('/api/chat')).json()
    expect(page.items.find((i: { type: string }) => i.type === 'owner')).toMatchObject({ text: 'what is this?', media: [{ path: file.path }] })
    close()
  })

  it('sends attachments without text, and refuses paths it did not upload', async () => {
    const { video, req, close } = setup()
    const up = await (await req('/api/uploads?name=clip.mp4', { method: 'POST', body: 'v' })).json()
    const ok = await req('/api/messages', { method: 'POST', body: JSON.stringify({ attachments: [up.file.path] }) })
    expect((await ok.json()).item).toMatchObject({ text: '', media: [{ kind: 'video' }] })
    for (const p of [video, '/etc/passwd', `${up.file.path}/../../../outside.txt`, 42]) {
      const bad = await req('/api/messages', { method: 'POST', body: JSON.stringify({ text: 'x', attachments: [p] }) })
      expect(bad.status, String(p)).toBe(400)
    }
    close()
  })

  it('refuses uploads over the limit and deletes only uploads', async () => {
    const { home, video, req, close } = setup()
    const big = await req('/api/uploads?name=big.bin', { method: 'POST', body: new Uint8Array((1 << 20) + 1) })
    expect(big.status).toBe(413)
    const up = await (await req('/api/uploads?name=a.txt', { method: 'POST', body: 'a' })).json()
    expect((await req(`/api/uploads?path=${encodeURIComponent(video)}`, { method: 'DELETE' })).status).toBe(404)
    expect(existsSync(video)).toBe(true)
    // A link elsewhere that points at an upload is not removed, and neither is the upload through it.
    const link = join(home, 'Downloads', 'link.txt')
    symlinkSync(up.file.path, link)
    expect((await req(`/api/uploads?path=${encodeURIComponent(link)}`, { method: 'DELETE' })).status).toBe(200)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(existsSync(up.file.path)).toBe(false)
    const again = await (await req('/api/uploads?name=a.txt', { method: 'POST', body: 'a' })).json()
    expect((await req(`/api/uploads?path=${encodeURIComponent(again.file.path)}`, { method: 'DELETE' })).status).toBe(200)
    expect(existsSync(again.file.path)).toBe(false)
    close()
  })

  it('serves media with ranges for seeking', async () => {
    const { home, video, req, close } = setup()
    const q = `/api/media?path=${encodeURIComponent(video)}`
    const full = await req(q)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-length')).toBe('1000')
    expect((await full.arrayBuffer()).byteLength).toBe(1000)

    const part = await req(q, { headers: { range: 'bytes=100-199' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000')
    const bytes = new Uint8Array(await part.arrayBuffer())
    expect(bytes.length).toBe(100)
    expect(bytes[0]).toBe(100)

    // A whole-file range on a big video comes back in pieces, so players never hold a connection for the whole file.
    const big = join(home, 'Downloads', 'big.mp4')
    writeFileSync(big, Buffer.alloc(RANGE_CHUNK + 10))
    const first = await req(`/api/media?path=${encodeURIComponent(big)}`, { headers: { range: 'bytes=0-' } })
    expect(first.headers.get('content-range')).toBe(`bytes 0-${RANGE_CHUNK - 1}/${RANGE_CHUNK + 10}`)
    expect((await first.arrayBuffer()).byteLength).toBe(RANGE_CHUNK)
    expect((await req(`/api/media?path=${encodeURIComponent(big)}`)).headers.get('content-length')).toBe(String(RANGE_CHUNK + 10))

    const tail = await req(q, { headers: { range: 'bytes=-10' } })
    expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000')
    const bad = await req(q, { headers: { range: 'bytes=5000-' } })
    expect(bad.status).toBe(416)
    expect(bad.headers.get('content-range')).toBe('bytes */1000')

    const etag = full.headers.get('etag')!
    expect((await req(q, { headers: { 'if-none-match': etag } })).status).toBe(304)
    expect((await req(q, { method: 'HEAD' })).status).toBe(200)
    close()
  })

  it('never serves a page that could run script, and refuses escapes', async () => {
    const { home, req, close } = setup()
    const html = await req(`/api/media?path=${encodeURIComponent(join(home, 'Downloads', 'page.html'))}`)
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(html.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(html.headers.get('content-security-policy')).toMatch(/sandbox/)
    expect((await req(`/api/media?path=${encodeURIComponent(`${home}/Downloads/../outside.txt`)}`)).status).toBe(403)
    expect((await req('/api/media?path=%2Fetc%2Fpasswd')).status).toBe(403)
    expect((await req('/api/media?path=relative.txt')).status).toBe(400)
    close()
  })

  it('refuses other sites, other hosts without a token, and anyone without the token', async () => {
    const { video, req, close } = setup()
    const q = `/api/media?path=${encodeURIComponent(video)}`
    expect((await req(q, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await req('/api/uploads?name=a', { method: 'POST', body: 'a', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await req(q, { headers: { host: 'rebind.evil.com:4788' } })).status).toBe(403)
    expect((await req(q, { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200)
    close()
    const t = setup('s3cret')
    const anon = await t.req(q.replace(encodeURIComponent(video), encodeURIComponent(t.video)), { headers: { authorization: '' } })
    expect(anon.status).toBe(401)
    expect((await t.req(`/api/media?path=${encodeURIComponent(t.video)}`, { headers: { host: 'my.tailnet.ts.net' } })).status).toBe(200)
    t.close()
  })

  it('shows files a captain reply names', async () => {
    const { video, mem, req, close } = setup()
    mem.append('captain', `Here it is: ${video}`)
    const page = await (await req('/api/chat')).json()
    expect(page.items.at(-1)).toMatchObject({ type: 'captain', text: `Here it is: ${video}`, media: [{ path: video, kind: 'video', size: 1000 }] })
    close()
  })
})
