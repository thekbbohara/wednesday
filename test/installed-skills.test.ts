import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedSkills } from '../src/skills/installed.ts'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

it('follows symlinks, folds descriptions and deduplicates all installation sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'installed-skills-')); dirs.push(root)
  const home = join(root, 'home'), repo = join(root, 'repo'), vendor = join(root, 'vendor')
  await mkdir(vendor, { recursive: true })
  await writeFile(join(vendor, 'SKILL.md'), '---\nname: video-edit\ndescription: "Edit clips into reels."\n---\n')
  for (const dir of [join(home, '.claude/skills'), join(home, '.claude-work/skills'), join(repo, 'skills')]) {
    await mkdir(dir, { recursive: true })
    await symlink(vendor, join(dir, 'video-edit'))
  }
  const design = join(repo, 'skills/design'); await mkdir(design)
  await writeFile(join(design, 'SKILL.md'), "---\nname: 'design'\ndescription: >\n  Visual work:\n  pages and dashboards.\n---\n")
  await symlink(join(root, 'missing'), join(home, '.claude/skills/broken'))
  const result = await installedSkills({ home, repo })
  expect(result.map((s) => s.name)).toEqual(['design', 'video-edit'])
  expect(result[0].description).toBe('Visual work: pages and dashboards.')
  expect(result[1].description).toBe('Edit clips into reels.')
  expect(result[1].installations.map((i) => [i.place, i.source])).toEqual([
    ['Wednesday', 'Claude Code'], ['Wednesday', 'Repository'], ['ClipCrew', 'ClipCrew'],
  ])
  expect(result[1].installations.every((i) => i.resolvedPath === join(vendor, 'SKILL.md'))).toBe(true)
})

it('treats absent roots as empty and uses the directory name without frontmatter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'installed-skills-')); dirs.push(root)
  expect(await installedSkills({ home: root, repo: root })).toEqual([])
  await mkdir(join(root, 'skills/plain'), { recursive: true })
  await writeFile(join(root, 'skills/plain/SKILL.md'), '# Plain skill')
  expect(await installedSkills({ home: root, repo: root })).toMatchObject([{ name: 'plain', description: '' }])
})
