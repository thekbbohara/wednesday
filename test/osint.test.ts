// The OSINT skill's keyless scripts and structure. Network-free paths only, so
// the suite stays deterministic; live recon (crt.sh, wayback) is used by agents.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../skills/osint')
const run = (script: string, args: string[] = []) => {
  const cmd = script.endsWith('.py') ? 'python3' : 'bash'
  try {
    return { out: execFileSync(cmd, [join(root, 'scripts', script), ...args], { encoding: 'utf8' }), code: 0 }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status }
  }
}

describe('osint skill', () => {
  it('ships the skill, scripts, references and template', () => {
    for (const f of ['SKILL.md', 'scripts/diagnose.sh', 'scripts/recon.sh', 'scripts/scrape.py', 'scripts/install-osint.sh', 'references/sources.md', 'references/platforms.md', 'references/psychoprofile.md', 'assets/report-template.md'])
      expect(existsSync(join(root, f)), f).toBe(true)
  })

  it('states the scope boundaries up front', () => {
    const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/## Scope/)
    expect(skill).toMatch(/NOT for:[\s\S]*surveil|locat|harass/)
    expect(skill).toMatch(/Open sources and the owner's own data only/)
    // The hard limits are stated as limits, not softened away.
    expect(skill).toMatch(/real-time location or movements/)
    expect(skill).toMatch(/intimidate or harass/)
  })

  it('diagnose runs and reports the toolkit', () => {
    const r = run('diagnose.sh')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/OSINT toolkit/)
    expect(r.out).toMatch(/scrapling/)
  })

  it('recon.sh validates input and needs no network for footprint/meta', () => {
    expect(run('recon.sh').code).toBe(2)
    expect(run('recon.sh', ['domain']).out).toMatch(/needs an argument/)
    const fp = run('recon.sh', ['footprint', 'somehandle'])
    expect(fp.code).toBe(0)
    expect(fp.out).toMatch(/web_search "somehandle"/)
    expect(fp.out).toMatch(/own emails only/)
    expect(run('recon.sh', ['meta', '/no/such/file']).out).toMatch(/no such file/)
  })

  it('scrape.py fails clearly when scrapling is absent, not with a stack trace', () => {
    // The skill venv is not built in CI; the guard must be graceful.
    // System python3 has no scrapling: the guard must exit 3 with how to fix it, not a stack trace.
    const r = run('scrape.py', ['https://example.com'])
    if (/Run scripts\/install-osint\.sh/.test(r.out)) expect(r.code).toBe(3)
    else expect([0, 1]).toContain(r.code) // a venv python with scrapling: real fetch or network error
    expect(r.out).not.toMatch(/Traceback/)
  })
})
