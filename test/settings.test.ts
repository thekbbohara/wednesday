import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { apply, currentSettings, loadSettings, saveSettings } from '../src/settings.ts'

describe('settings file', () => {
  it('saves what the UI set and loads it over env defaults on the next start', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-set-'))
    const cfg = loadConfig({ dataDir })
    apply(cfg, { model: 'sonnet', web: true, sleepAt: '' })
    saveSettings(cfg)
    expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))).toMatchObject({ model: 'sonnet', web: true, sleepAt: '' })
    const next = loadConfig({ dataDir })
    loadSettings(next)
    expect(currentSettings(next)).toMatchObject({ model: 'sonnet', web: true, sleepAt: '' })
  })

  it('ignores bad values and a broken file, with a warning instead of a crash', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'majordomo-set-'))
    const warnings: string[] = []
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ model: 'sonnet', maxTurns: 1 }))
    const cfg = loadConfig({ dataDir })
    loadSettings(cfg, (m) => warnings.push(m))
    expect(cfg.model).toBe('sonnet')
    expect(cfg.maxTurns).toBe(40)
    expect(warnings).toEqual(['settings.json: ignoring maxTurns'])
    writeFileSync(join(dataDir, 'settings.json'), '{ nope')
    loadSettings(loadConfig({ dataDir }), (m) => warnings.push(m))
    expect(warnings[1]).toMatch(/not valid JSON/)
  })
})

describe('assistant name', () => {
  it('comes from ASSISTANT_NAME, defaulting to Wednesday', async () => {
    const { loadConfig } = await import('../src/config.ts')
    const prev = process.env.ASSISTANT_NAME
    try {
      delete process.env.ASSISTANT_NAME
      expect(loadConfig().name).toBe('Wednesday')
      process.env.ASSISTANT_NAME = 'Friday'
      expect(loadConfig().name).toBe('Friday')
      process.env.ASSISTANT_NAME = '   '
      expect(loadConfig().name).toBe('Wednesday')
    } finally {
      if (prev === undefined) delete process.env.ASSISTANT_NAME
      else process.env.ASSISTANT_NAME = prev
    }
  })
})
