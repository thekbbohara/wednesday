// Tests build their own config: settings inherited from the shell (an agent
// session exports MAJORDOMO_ALLOWED_TOOLS, MAJORDOMO_MODEL, ...) must not leak in.
// WEDNESDAY_LIVE* / MAJORDOMO_LIVE* stay, they opt into the live tests.
for (const key of Object.keys(process.env)) {
  if (/^(WEDNESDAY|MAJORDOMO)_/.test(key) && !/_LIVE/.test(key)) delete process.env[key]
}
