import { readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface SkillSource {
  place: 'Wednesday' | 'ClipCrew'
  source: 'Claude Code' | 'Repository' | 'ClipCrew'
  path: string
  resolvedPath: string
}
export interface InstalledSkill {
  name: string
  description: string
  installations: SkillSource[]
}

/** Skill frontmatter uses plain/quoted scalars or YAML folded/literal text. */
function metadata(text: string): Record<string, string> {
  const block = text.replace(/^\uFEFF/, '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s|$)/)?.[1]
  if (!block) return {}
  const result: Record<string, string> = {}
  const lines = block.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(name|description):\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (/^[>|][+-]?(?:\s+#.*)?$/.test(value) || !value) {
      const continuation: string[] = []
      while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1])) continuation.push(lines[++i].trim())
      value = continuation.join(' ')
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value) } catch { value = value.replace(/^"|"$/g, '') }
    } else if (value.startsWith("'")) {
      value = value.replace(/^'|'$/g, '').replace(/''/g, "'")
    } else value = value.replace(/\s+#.*$/, '')
    result[match[1]] = value.replace(/\s+/g, ' ').trim()
  }
  return result
}

/** Read only, including directory/file symlinks. Missing or broken entries are empty. */
export async function installedSkills(options: { home?: string; repo?: string } = {}): Promise<InstalledSkill[]> {
  const home = options.home ?? homedir()
  const repo = options.repo ?? resolve(import.meta.dirname, '../..')
  const roots = [
    { dir: join(home, '.claude/skills'), place: 'Wednesday', source: 'Claude Code' },
    { dir: join(repo, 'skills'), place: 'Wednesday', source: 'Repository' },
    { dir: join(home, '.claude-work/skills'), place: 'ClipCrew', source: 'ClipCrew' },
  ] as const
  const skills = new Map<string, InstalledSkill>()
  for (const root of roots) {
    const entries = await readdir(root.dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
      throw error
    })
    for (const entry of entries.sort()) {
      const path = join(root.dir, entry, 'SKILL.md')
      let text: string, resolvedPath: string
      try { [text, resolvedPath] = await Promise.all([readFile(path, 'utf8'), realpath(path)]) }
      catch (error) {
        if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
        throw error
      }
      const meta = metadata(text)
      const name = meta.name || entry
      const skill: InstalledSkill = skills.get(name) ?? { name, description: meta.description || '', installations: [] }
      if (!skill.description && meta.description) skill.description = meta.description
      skill.installations.push({ place: root.place, source: root.source, path, resolvedPath })
      skills.set(name, skill)
    }
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
}
