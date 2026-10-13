/**
 * 把曲库和运行期数据清回刚部署完的空表。
 *
 *   node scripts/reset.mjs          # 只打印将要删除的内容
 *   node scripts/reset.mjs --yes    # 真正清空
 *
 * 会断开正在使用这份库的连接（包括 pnpm dev / PM2），跑完后需要重启服务。
 * 保留 config.yaml 和 data/user-api/current.js。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { parse as parseYaml } from 'yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const yes = process.argv.includes('--yes')
const help = process.argv.includes('-h') || process.argv.includes('--help')

if (help) {
  console.log(`用法：node scripts/reset.mjs [--yes]

不带 --yes 只列出将要清除的内容。
清除 Postgres 曲库（歌手、专辑、歌曲、歌单、收藏、设置），以及 data/ 里的缓存、封面、旧 SQLite 和口令密钥。
保留 config.yaml 和音源脚本 data/user-api/current.js。`)
  process.exit(0)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function loadConfig() {
  const configPath = process.env.TINGGUI_CONFIG ?? path.resolve(process.cwd(), 'config.yaml')
  if (!existsSync(configPath)) {
    fail(`找不到配置：${configPath}\n在仓库根目录执行，或设置 TINGGUI_CONFIG`)
  }
  const parsed = parseYaml(readFileSync(configPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`配置不是一份映射：${configPath}`)
  }
  const databaseUrl = typeof parsed.databaseUrl === 'string' ? parsed.databaseUrl.trim() : ''
  if (!databaseUrl) fail('config.yaml 没有 databaseUrl，无法确定要清空哪一份库')
  const dataDirRaw = typeof parsed.dataDir === 'string' && parsed.dataDir.trim() !== ''
    ? parsed.dataDir
    : './data'
  return {
    configPath,
    databaseUrl,
    dataDir: path.resolve(process.cwd(), dataDirRaw),
  }
}

/** 这些是运行期产物。音源脚本留在 data/user-api，不在这份名单里。 */
const DATA_NAMES = ['cache', 'covers', 'lx-sync.db', 'subsonic.key']

function dataTargets(dataDir) {
  return DATA_NAMES
    .map((name) => path.join(dataDir, name))
    .filter((target) => existsSync(target))
}

const cfg = loadConfig()
const targets = dataTargets(cfg.dataDir)

console.log('将清空：')
console.log(`  Postgres：${cfg.configPath} 里的 databaseUrl 指向的库（public 模式整份删掉后按迁移重建空表）`)
console.log(`  数据目录：${cfg.dataDir}`)
if (targets.length === 0) console.log('    （缓存、封面、旧库、口令密钥都不在）')
for (const target of targets) console.log(`    ${target}`)
console.log('保留：config.yaml、data/user-api/current.js')

if (!yes) {
  console.log('\n这只是预览。确认清空请执行：node scripts/reset.mjs --yes')
  process.exit(0)
}

const client = new pg.Client({ connectionString: cfg.databaseUrl })
try {
  await client.connect()
} catch (err) {
  fail(`连不上 Postgres：${err instanceof Error ? err.message : err}`)
}

try {
  await client.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()`,
  )
  await client.query('DROP SCHEMA IF EXISTS public CASCADE')
  await client.query('CREATE SCHEMA public')
  await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER')

  const sqlDir = path.join(root, 'src', 'db', 'sql')
  const files = readdirSync(sqlDir).filter((name) => name.endsWith('.sql')).sort()
  for (const file of files) {
    await client.query(readFileSync(path.join(sqlDir, file), 'utf8'))
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file])
  }
  console.log(`已重建空表：${files.join('、')}`)
} catch (err) {
  fail(`清空数据库失败：${err instanceof Error ? err.message : err}`)
} finally {
  await client.end().catch(() => {})
}

for (const target of targets) {
  try {
    await rm(target, { recursive: true, force: true })
    console.log(`已删除 ${target}`)
  } catch (err) {
    console.error(`删不掉 ${target}：${err instanceof Error ? err.message : err}`)
  }
}

console.log('完成。正在跑的服务已和数据库断开，请重启后再用。')
