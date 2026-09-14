import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema.js'

export type { Database }

export function openDb(filePath: string): Database.Database {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA_SQL)
  return db
}
