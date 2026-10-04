import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Memory } from '../src/memory/store.ts'
import { expForLevel, levelFor, progress } from '../src/skills/levels.ts'
import { DEFAULT_SKILLS, loadSkills } from '../src/skills/skills.ts'

describe('levels', () => {
  it('costs 50 more EXP per level', () => {
    expect([1, 2, 3, 4, 5].map(expForLevel)).toEqual([0, 100, 250, 450, 700])
    expect([0, 99, 100, 249, 250, 700].map(levelFor)).toEqual([1, 1, 2, 2, 3, 5])
    expect(progress(180)).toEqual({ level: 2, exp: 180, floor: 100, next: 250 })
    expect(progress(300, 3)).toEqual({ level: 2, exp: 300, floor: 300, next: 750 })
  })
})

describe('skills config', () => {
  it('uses the defaults, extended by skills.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-skills-'))
    expect(loadSkills(dir)).toBe(DEFAULT_SKILLS)
    writeFileSync(join(dir, 'skills.json'), JSON.stringify([{ id: 'music', name: 'Music', color: '#f78fb3' }, { id: 'coding', color: '#000000' }]))
    const s = loadSkills(dir)
    expect(s.find((x) => x.id === 'music')).toMatchObject({ name: 'Music', color: '#f78fb3' })
    expect(s.find((x) => x.id === 'coding')).toMatchObject({ name: 'Coding', color: '#000000' })
    writeFileSync(join(dir, 'skills.json'), JSON.stringify([{ id: 'Bad Id' }]))
    expect(() => loadSkills(dir)).toThrow(/bad skill id/)
  })
})

describe('EXP from tasks', () => {
  it('pays for creating and finishing, once, with a bonus for delegated work', () => {
    const m = new Memory(':memory:')
    const t = m.taskCreate({ title: 'Fix login', goal: 'users can log in', skill: 'coding' })
    expect(m.expBySkill().get('coding')).toBe(5)
    m.taskUpdate(t.id, { status: 'done', result: 'fixed' })
    expect(m.expBySkill().get('coding')).toBe(35)
    // Reopened and finished again: no second payout.
    m.taskUpdate(t.id, { status: 'open' })
    m.taskUpdate(t.id, { status: 'done' })
    expect(m.expBySkill().get('coding')).toBe(35)

    const d = m.taskCreate({ title: 'Landing page', goal: 'g', skill: 'design' })
    m.agentCreate({ id: 'painter', task_id: d.id, runtime: 'claude-code', cwd: '/tmp', repo: null, branch: null, brief: 'b' })
    m.taskUpdate(d.id, { status: 'done' })
    expect(m.expEvents('design').map((e) => [e.amount, e.reason])).toEqual([
      [20, `delegated T${d.id} to painter`],
      [30, `finished T${d.id} Landing page`],
      [5, `created T${d.id} Landing page`],
    ])

    const chore = m.taskCreate({ title: 'Buy tea', goal: 'g' })
    m.taskUpdate(chore.id, { status: 'done' })
    expect([...m.expBySkill().keys()].sort()).toEqual(['coding', 'design'])
  })

  it('writes level-ups to the ledger, for the skill and for Jarvis', () => {
    const m = new Memory(':memory:')
    for (let i = 0; i < 3; i++) m.taskUpdate(m.taskCreate({ title: `job ${i}`, goal: 'g', skill: 'coding' }).id, { status: 'done' })
    // 3 x 35 = 105 coding EXP: coding reaches level 2; Jarvis needs 300 for its level 2.
    const ups = m.ledgerTail(10, ['system']).map((e) => e.meta?.levelup)
    expect(ups).toEqual([{ skill: 'coding', level: 2 }])
    for (let i = 0; i < 6; i++) m.taskUpdate(m.taskCreate({ title: `more ${i}`, goal: 'g', skill: 'ops' }).id, { status: 'done' })
    expect(m.ledgerTail(10, ['system']).map((e) => e.text)).toContain('Jarvis reached level 2')
  })

  it('keeps EXP append-only', () => {
    const m = new Memory(':memory:')
    m.taskCreate({ title: 't', goal: 'g', skill: 'coding' })
    expect(() => m.db.exec('UPDATE exp SET amount = 9999')).toThrow(/append-only/)
    expect(() => m.db.exec('DELETE FROM exp')).toThrow(/append-only/)
  })
})

describe('migration to v3', () => {
  it('upgrades a v2 file by hand, with a backup, and keeps its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-mig-'))
    const path = join(dir, 'memory.db')
    const m = new Memory(path)
    m.taskCreate({ title: 'old task', goal: 'g' })
    m.close()
    // Turn it into a v2 file: no exp table, no tasks.skill.
    const d = new DatabaseSync(path)
    d.exec("DROP TABLE exp; ALTER TABLE tasks DROP COLUMN skill; UPDATE meta SET value = '2' WHERE key = 'schema_version'")
    d.close()
    expect(() => new Memory(path)).toThrow(/node src\/migrate.ts/)
    const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '../src/migrate.ts'), path]).toString()
    expect(out).toMatch(/v2 -> v3 \(backup: .*memory.db.bak-v2\)/)
    const after = new Memory(path)
    expect(after.taskList()[0]).toMatchObject({ title: 'old task', skill: null })
    after.taskCreate({ title: 'new', goal: 'g', skill: 'coding' })
    expect(after.expBySkill().get('coding')).toBe(5)
  })
})
