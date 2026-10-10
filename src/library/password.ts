import { execFile } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type pg from 'pg'

const execFileAsync = promisify(execFile)

const PASSWORD_KEY = 'subsonicPassword'
const KEY_FILE = 'subsonic.key'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * 客户端的 t 是 md5(口令 + salt)，校验时必须拿回口令。
 * 所以这里存 AES-256-GCM 密文，不做单向哈希。
 */
export async function setSubsonicPassword(
  dataDir: string,
  pool: pg.Pool,
  password: string,
): Promise<void> {
  const key = await ensureKey(dataDir)
  const stored = encrypt(key, password)
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [PASSWORD_KEY, stored],
  )
}

/**
 * 没有口令行时返回 null。
 * 密文在而密钥丢失或对不上时抛出，不能当成没设口令，否则非回环请求会被放行。
 * 错误信息不带路径：数据目录常常落在用户主目录下。
 */
export async function readSubsonicPassword(
  dataDir: string,
  pool: pg.Pool,
): Promise<string | null> {
  const stored = await readSetting(pool, PASSWORD_KEY)
  if (stored === null || stored === '') return null
  try {
    return decrypt(await readKey(dataDir), stored)
  } catch {
    throw new Error('无法还原 Subsonic 口令')
  }
}

async function readSetting(pool: pg.Pool, key: string): Promise<string | null> {
  const result = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [key],
  )
  return result.rows[0]?.value ?? null
}

function keyPath(dataDir: string): string {
  return join(dataDir, KEY_FILE)
}

async function readKey(dataDir: string): Promise<Buffer> {
  const bytes = await readFile(keyPath(dataDir))
  if (bytes.length !== KEY_BYTES) throw new Error('subsonic.key 长度不是 32 字节')
  return bytes
}

/**
 * 密钥只在第一次写入。已经存在就沿用，换一把新的会让库里的密文解不开。
 * 权限收成当前用户：这把密钥能还原口令。
 */
async function ensureKey(dataDir: string): Promise<Buffer> {
  const path = keyPath(dataDir)
  try {
    const existing = await readKey(dataDir)
    await restrictKey(path)
    return existing
  } catch (err) {
    if (!isEnoent(err)) throw err
  }

  await mkdir(dataDir, { recursive: true })
  const created = randomBytes(KEY_BYTES)
  try {
    await writeFile(path, created, { mode: 0o600, flag: 'wx' })
  } catch (err) {
    if (!isEexist(err)) throw err
    const existing = await readKey(dataDir)
    await restrictKey(path)
    return existing
  }
  await restrictKey(path)
  return created
}

/**
 * POSIX 上 0o600 就是当前用户可读可写。
 * Windows 的 chmod 不区分属主和他人，新建文件还会继承 Users，所以再去掉继承，只留当前用户。
 * 不把 icacls 的输出带出去，里面有账户名。
 */
async function restrictKey(path: string): Promise<void> {
  await chmod(path, 0o600)
  if (platform() !== 'win32') return
  const account = process.env.USERNAME
  if (!account) throw new Error('无法收紧 subsonic.key 的权限')
  try {
    await execFileAsync('icacls', [path, '/inheritance:r', '/grant:r', `${account}:(M)`], {
      windowsHide: true,
    })
  } catch {
    throw new Error('无法收紧 subsonic.key 的权限')
  }
}

function isEnoent(err: unknown): boolean {
  return isCode(err, 'ENOENT')
}

function isEexist(err: unknown): boolean {
  return isCode(err, 'EEXIST')
}

function isCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code
}

/** iv、tag、ciphertext 三段 base64，用点分开，才能在一个 settings 值里还原。 */
function encrypt(key: Buffer, password: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64')).join('.')
}

function decrypt(key: Buffer, stored: string): string {
  const parts = stored.split('.')
  if (parts.length !== 3) throw new Error('无法还原 Subsonic 口令')
  const iv = Buffer.from(parts[0], 'base64')
  const tag = Buffer.from(parts[1], 'base64')
  const ciphertext = Buffer.from(parts[2], 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('无法还原 Subsonic 口令')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('无法还原 Subsonic 口令')
  }
}
