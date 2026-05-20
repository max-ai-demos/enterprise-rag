// apps/web/src/lib/db.ts
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? 'Lyx2020.',
  database: process.env.DB_NAME ?? 'enterprise_rag',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
})

export interface DbUser {
  id: string
  username: string
  password_hash: string
  role: string
  is_active: number
}

export async function getUserByUsername(username: string): Promise<DbUser | undefined> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    'SELECT * FROM users WHERE username = ? AND is_active = 1',
    [username]
  )
  return rows[0] as DbUser | undefined
}
