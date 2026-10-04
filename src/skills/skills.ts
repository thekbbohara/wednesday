// Jarvis's skills. Defaults below; override or extend in <data>/skills.json:
//   [{ "id": "music", "name": "Music", "color": "#f78fb3" }]
import { existsSync, readFileSync } from 'node:fs'
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
