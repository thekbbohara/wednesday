/** Owner rule: never the em dash. Enforced in code because models ignore it in prompts. */
export function plainDash(s: string): string {
  // An em dash is a sentence break ("next\u2014whether"), so it becomes a spaced dash; an en dash is a range ("2024\u20132025").
  return s.replace(/[ \t]*\u2014[ \t]*/g, ' - ').replace(/\u2013/g, '-')
}
