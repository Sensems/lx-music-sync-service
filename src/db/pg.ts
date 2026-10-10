import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/** SQL 与本文件同级的 sql/，tsx 直接跑源码时也能找到。 */
const sqlDir = join(dirname(fileURLToPath(import.meta.url)), 'sql')

export function openPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl })
}

/**
 * schema_migrations 由 001_library.sql 自己创建。
 * 第一次跑时表还不存在，不能先 SELECT 再执行，所以用 to_regclass 探测。
 */
async function isApplied(pool: pg.Pool, file: string): Promise<boolean> {
  const reg = await pool.query<{ reg: string | null }>(
    `SELECT to_regclass('public.schema_migrations') AS reg`,
  )
  if (!reg.rows[0]?.reg) return false
  const hit = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file])
  return (hit.rowCount ?? 0) > 0
}

/** 按文件名顺序执行尚未记录的 src/db/sql/*.sql。先跑 SQL，成功后再写入文件名。 */
export async function migrate(pool: pg.Pool): Promise<void> {
  const files = readdirSync(sqlDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (await isApplied(pool, file)) continue
    const sql = readFileSync(join(sqlDir, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file])
  }
}
