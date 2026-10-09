import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assistantEnv } from '../src/env.ts'
import { dataDir, defaultDataDir, loadConfig } from '../src/config.ts'
import { secretDir } from '../src/api-keys.ts'
import { ttsCacheDir } from '../src/tts.ts'

describe('Wednesday compatibility', () => {
  it('prefers new env names including empty values and reads legacy settings', () => {
    expect(assistantEnv('TOKEN', { MAJORDOMO_TOKEN: 'old' })).toBe('old')
    expect(assistantEnv('TOKEN', { WEDNESDAY_TOKEN: '', MAJORDOMO_TOKEN: 'old' })).toBe('')
    vi.stubEnv('WEDNESDAY_DATA_DIR', '/tmp/wednesday-config-only')
    vi.stubEnv('MAJORDOMO_DATA_DIR', '/tmp/legacy-config-only')
    vi.stubEnv('WEDNESDAY_MAX_TURNS', '51')
    vi.stubEnv('MAJORDOMO_MAX_TURNS', '40')
    try { expect(loadConfig()).toMatchObject({ dataDir: '/tmp/wednesday-config-only', maxTurns: 51 }) }
    finally { vi.unstubAllEnvs() }
  })
  it('defaults to ~/.wednesday and falls back to a legacy folder with one warning', () => {
    const home = mkdtempSync(join(tmpdir(), 'wednesday-home-'))
    const warn = vi.fn()
    try {
      expect(defaultDataDir(home, warn)).toBe(join(home, '.wednesday'))
      mkdirSync(join(home, '.majordomo'))
      expect(defaultDataDir(home, warn)).toBe(join(home, '.majordomo'))
      mkdirSync(join(home, '.jarvis'))
      expect(defaultDataDir(home, warn)).toBe(join(home, '.jarvis'))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('migrate-data-dir.sh')
      mkdirSync(join(home, '.wednesday'))
      expect(defaultDataDir(home, warn)).toBe(join(home, '.wednesday'))
      expect(existsSync(join(home, '.jarvis'))).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('keeps secrets and the voice cache in the data folder', () => {
    vi.stubEnv('WEDNESDAY_DATA_DIR', '/tmp/wednesday-data-only')
    try {
      expect(dataDir()).toBe('/tmp/wednesday-data-only')
      expect(secretDir()).toBe('/tmp/wednesday-data-only/secrets')
      expect(ttsCacheDir()).toBe('/tmp/wednesday-data-only/cache/tts')
    } finally { vi.unstubAllEnvs() }
  })
})
