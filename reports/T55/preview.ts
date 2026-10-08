// Isolated UI verification: no SQLite, supervisor, inference, or live data.
import { serve } from '@hono/node-server'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createApp } from '../../src/server.ts'
import { loadConfig } from '../../src/config.ts'
import type { Memory } from '../../src/memory/store.ts'
const cfg = loadConfig({ dataDir: mkdtempSync(join(tmpdir(), 't55-preview-')), sleepAt: '' })
const mem = {
  db: { prepare: () => ({ all: () => [] }) },
  lastLedgerId: () => 0, ledgerTail: () => [], ledgerSince: () => [],
  expBySkill: () => new Map(), expEvents: () => [], taskList: () => [],
  ledgerBefore: () => [],
} as unknown as Memory
const { app, close } = createApp({ mem, cfg, webRoot: resolve('dist'), runner: { run: async () => { throw new Error('Preview inference disabled') } } })
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 4855 })
process.on('SIGTERM', () => { close(); server.close(); process.exit(0) })
console.log('T55 isolated preview: http://127.0.0.1:4855/#/skills')
