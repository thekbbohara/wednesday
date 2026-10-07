// The design skill's structure and the rules worker agents rely on.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../skills/design')

describe('design skill', () => {
  it('ships the skill, style vocabulary and installer', () => {
    for (const f of ['SKILL.md', 'references/styles.md', 'scripts/install-design.sh'])
      expect(existsSync(join(root, f)), f).toBe(true)
  })

  it('has frontmatter workers can load', () => {
    const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/^---\nname: design\ndescription: >/)
  })

  it('keeps the DESIGN.md contract and the browser check', () => {
    const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/DESIGN\.md first/)
    expect(skill).toMatch(/No silent fallback/)
    expect(skill).toMatch(/375, 768, 1024\s+and 1440/)
  })

  it('never uses an em dash', () => {
    for (const f of ['SKILL.md', 'references/styles.md']) expect(readFileSync(join(root, f), 'utf8'), f).not.toContain('—')
  })
})
