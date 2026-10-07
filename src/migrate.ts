#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Upgrades a Wednesday memory file to the current schema. Run by hand:
//   node src/migrate.ts ~/.majordomo/memory.db
// It copies the file to <file>.bak-v<old> first, then applies each step in one transaction.
import { copyFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, SCHEMA_VERSION } from './memory/store.ts'

const path = process.argv[2]
if (!path || !existsSync(path)) {
  console.error('usage: node src/migrate.ts <path to memory.db>')
  process.exit(2)
}
const db = new DatabaseSync(path)
const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
const from = Number(row?.value ?? 0)
if (!from) throw new Error(`${path} is not a Wednesday memory file`)
if (from === SCHEMA_VERSION) {
  console.log(`${path} is already at v${SCHEMA_VERSION}`)
  process.exit(0)
}
if (from > SCHEMA_VERSION) throw new Error(`${path} is v${from}, newer than this code (v${SCHEMA_VERSION})`)

db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
const backup = `${path}.bak-v${from}`
copyFileSync(path, backup)
db.exec('BEGIN')
try {
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    db.exec(MIGRATIONS[v])
    console.log(`applied v${v}`)
  }
  db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION))
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}
console.log(`${path}: v${from} -> v${SCHEMA_VERSION} (backup: ${backup})`)
