/** Owner rule: never the em dash. Enforced in code because models ignore it in prompts. */
export function plainDash(s: string): string {
  return s.replace(/\s*\u2014\s*/g, (m) => (/^\s|\s$/.test(m) ? ' - ' : '-')).replace(/\u2013/g, '-')
}
