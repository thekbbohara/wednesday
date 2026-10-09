import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dirname, '../scripts/migrate-data-dir.sh')

/** A throwaway HOME with a legacy ~/.jarvis and a fake systemctl reporting `active` units. */
function sandbox(active: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'wednesday-migrate-'))
  mkdirSync(join(home, '.jarvis'))
  writeFileSync(join(home, '.jarvis', 'memory.db'), 'db')
  mkdirSync(join(home, '.config/systemd/user'), { recursive: true })
  writeFileSync(join(home, '.config/systemd/user/wednesday-captain.service'), `WorkingDirectory=${home}/.jarvis/worktrees/live\n`)
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh
case "$*" in
  *list-units*) for u in ${active.join(' ')}; do echo "$u loaded active running x"; done ;;
  *is-active*) for u in ${active.join(' ')}; do [ "$u" = "$4" ] && exit 0; done; exit 3 ;;
esac
`)
  chmodSync(join(bin, 'systemctl'), 0o755)
  const run = (...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } })
  return { home, run, done: () => rmSync(home, { recursive: true, force: true }) }
}

describe('scripts/migrate-data-dir.sh', () => {
  it('dry run changes nothing and lists files that mention ~/.jarvis', () => {
    const s = sandbox()
    try {
      const r = s.run()
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Dry run: would run')
      expect(r.stdout).toContain('wednesday-captain.service')
      expect(lstatSync(join(s.home, '.jarvis')).isDirectory()).toBe(true)
      expect(existsSync(join(s.home, '.wednesday'))).toBe(false)
    } finally { s.done() }
  })

  it('refuses while the captain service is active', () => {
    const s = sandbox(['wednesday-captain.service'])
    try {
      const r = s.run('--apply')
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('BLOCK  unit wednesday-captain.service is active')
      expect(existsSync(join(s.home, '.wednesday'))).toBe(false)
    } finally { s.done() }
  })

  it('--apply moves the folder and leaves a symlink, then is a no-op', () => {
    const s = sandbox()
    try {
      expect(s.run('--apply').status).toBe(0)
      expect(readFileSync(join(s.home, '.wednesday', 'memory.db'), 'utf8')).toBe('db')
      expect(readlinkSync(join(s.home, '.jarvis'))).toBe(join(s.home, '.wednesday'))
      expect(readFileSync(join(s.home, '.jarvis', 'memory.db'), 'utf8')).toBe('db')
      const again = s.run('--apply')
      expect(again.status).toBe(0)
      expect(again.stdout).toContain('Already migrated')
    } finally { s.done() }
  })

  it('never merges into an existing ~/.wednesday', () => {
    const s = sandbox()
    try {
      mkdirSync(join(s.home, '.wednesday'))
      const r = s.run('--apply')
      expect(r.status).toBe(1)
      expect(lstatSync(join(s.home, '.jarvis')).isDirectory()).toBe(true)
    } finally { s.done() }
  })
})
