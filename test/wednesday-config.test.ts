import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assistantEnv } from '../src/env.ts'
import { defaultDataDir, loadConfig } from '../src/config.ts'

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
  it('reuses historical directories without moving or creating memory', () => {
    const home = mkdtempSync(join(tmpdir(), 'wednesday-home-'))
    try {
      expect(defaultDataDir(home)).toBe(join(home, '.wednesday'))
      mkdirSync(join(home, '.jarvis'))
      expect(defaultDataDir(home)).toBe(join(home, '.jarvis'))
      mkdirSync(join(home, '.wednesday'))
      expect(defaultDataDir(home)).toBe(join(home, '.jarvis'))
      mkdirSync(join(home, '.majordomo'))
      expect(defaultDataDir(home)).toBe(join(home, '.majordomo'))
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})
