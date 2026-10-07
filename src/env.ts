/** Wednesday names win; existing Majordomo installations remain compatible. */
export function assistantEnv(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`WEDNESDAY_${key}`] ?? env[`MAJORDOMO_${key}`]
}
