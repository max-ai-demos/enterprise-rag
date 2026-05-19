// apps/web/src/lib/db.ts
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? '../../data/enterprise_rag.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: false })
    _db.pragma('journal_mode = WAL')
  }
  return _db
}

export interface DbUser {
  id: string
  username: string
  password_hash: string
  role: string
  is_active: number
}

export function getUserByUsername(username: string): DbUser | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
    .get(username) as DbUser | undefined
}
