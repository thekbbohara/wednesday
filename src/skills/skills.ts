// Majordomo's skills. Defaults below; override or extend in <data>/skills.json:
//   [{ "id": "music", "name": "Music", "color": "#f78fb3" }]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Skill {
  id: string
  name: string
  color: string
  /** One line the captain uses to tag tasks. */
  covers: string
}

export const DEFAULT_SKILLS: Skill[] = [
  { id: 'coding', name: 'Coding', color: '#5cbdf4', covers: 'writing, fixing, reviewing and shipping code' },
  { id: 'design', name: 'Design', color: '#f78fb3', covers: 'UI, UX, visuals, brand, video and motion' },
  { id: 'marketing', name: 'Marketing', color: '#ffb547', covers: 'social posts, copy for growth, SEO, launches, outreach' },
  { id: 'hacking', name: 'Hacking', color: '#4fd1a5', covers: 'security, reverse engineering, scraping, CTFs, pentest work' },
  { id: 'research', name: 'Research', color: '#7c8cf8', covers: 'finding out, comparing options, market and technical research' },
  { id: 'writing', name: 'Writing', color: '#b28cf5', covers: 'docs, articles, emails, scripts, proposals' },
  { id: 'ops', name: 'Ops', color: '#8fb3c9', covers: 'servers, deploys, Docker, backups, admin and money chores' },
]

export const SKILL_ID = /^[a-z][a-z0-9-]{0,23}$/

/** Upper bound on the skill tree, so self-added skills cannot sprawl. */
export const MAX_SKILLS = 16

/** Colours for skills added later, in order of use. */
const PALETTE = ['#e8793a', '#f2c94c', '#56ccf2', '#eb5757', '#27ae60', '#bb6bd9', '#2d9cdb', '#f2994a', '#6fcf97']

export function skillId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
}

export function loadSkills(dataDir: string): Skill[] {
  const file = join(dataDir, 'skills.json')
  if (!existsSync(file)) return DEFAULT_SKILLS
  const overrides = JSON.parse(readFileSync(file, 'utf8')) as Array<Partial<Skill> & { id: string }>
  const merged = new Map(DEFAULT_SKILLS.map((s) => [s.id, s]))
  for (const o of overrides) {
    if (!SKILL_ID.test(o.id)) throw new Error(`skills.json: bad skill id "${o.id}" (lowercase letters, digits, dashes)`)
    const base = merged.get(o.id)
    merged.set(o.id, { name: o.id, color: '#8fb3c9', covers: '', ...base, ...o })
  }
  return [...merged.values()]
}

/**
 * Adds a skill to <data>/skills.json (the same file the owner can edit).
 * Refuses duplicates and anything past MAX_SKILLS.
 */
export function addSkill(dataDir: string, input: { name: string; covers: string; color?: string }): Skill {
  const name = input.name.trim()
  const id = skillId(name)
  if (!SKILL_ID.test(id) || name.length < 2) throw new Error(`"${input.name}" is not a usable skill name`)
  const covers = input.covers.trim()
  if (!covers) throw new Error('say what the skill covers, in one line')
  const current = loadSkills(dataDir)
  const dupe = current.find((s) => s.id === id || s.name.toLowerCase() === name.toLowerCase())
  if (dupe) throw new Error(`a skill "${dupe.name}" already exists`)
  if (current.length >= MAX_SKILLS) throw new Error(`the skill tree is full (${MAX_SKILLS}); tag the work with an existing skill: ${current.map((s) => s.id).join(', ')}`)
  if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('color must look like #e8793a')
  const used = new Set(current.map((s) => s.color.toLowerCase()))
  const color = input.color ?? PALETTE.find((c) => !used.has(c)) ?? '#8fb3c9'
  const file = join(dataDir, 'skills.json')
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Array<Partial<Skill>>) : []
  const skill: Skill = { id, name, color, covers }
  writeFileSync(file, `${JSON.stringify([...saved, skill], null, 2)}\n`)
  return skill
}
