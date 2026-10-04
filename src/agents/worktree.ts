// A clean git worktree per agent, so parallel jobs on one repo never collide.
import { execFile } from 'node:child_process'

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout.trim())
    })
  })
}

/** Top level of the git repo containing `dir`, or null. */
export async function repoRoot(dir: string): Promise<string | null> {
  try {
    return await git(['-C', dir, 'rev-parse', '--show-toplevel'])
  } catch {
    return null
  }
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/** New worktree at `path` on a new branch from `base` (default: the repo's current HEAD). */
export async function addWorktree(repo: string, path: string, branch: string, base?: string): Promise<void> {
  if (await branchExists(repo, branch)) throw new Error(`branch ${branch} already exists in ${repo}`)
  await git(['-C', repo, 'worktree', 'add', '-b', branch, path, base || 'HEAD'])
}

/** Uncommitted changes (`git status --porcelain`), empty when clean. */
export async function worktreeChanges(path: string): Promise<string> {
  return git(['-C', path, 'status', '--porcelain'])
}

/** Removes the worktree folder; the branch and its commits stay in the repo. Refuses when there are uncommitted changes. */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  const changes = await worktreeChanges(path).catch(() => '')
  if (changes) throw new Error(`worktree ${path} has uncommitted changes:\n${changes.split('\n').slice(0, 10).join('\n')}`)
  await git(['-C', repo, 'worktree', 'remove', path])
}
