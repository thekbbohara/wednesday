// EXP and levels. Each level costs 50 more EXP than the last:
// Lv 2 at 100, Lv 3 at 250, Lv 4 at 450, Lv 5 at 700, ...

/** Total EXP needed to reach `level` (level 1 needs 0). */
export function expForLevel(level: number): number {
  return 25 * (level - 1) * (level + 2)
}

export function levelFor(exp: number): number {
  let level = 1
  while (expForLevel(level + 1) <= exp) level++
  return level
}

export interface Progress {
  level: number
  exp: number
  /** EXP at the start of this level and at the next one. */
  floor: number
  next: number
}

export function progress(exp: number, scale = 1): Progress {
  const level = levelFor(exp / scale)
  return { level, exp, floor: expForLevel(level) * scale, next: expForLevel(level + 1) * scale }
}

/** Wednesday's own level grows on all EXP, at a slower pace. */
export const OVERALL_SCALE = 3

/** What earns EXP, per task, for the task's skill. */
export const EXP_RULES = {
  created: 5,
  finished: 30,
  /** Extra when an agent did the work. */
  delegated: 20,
} as const
