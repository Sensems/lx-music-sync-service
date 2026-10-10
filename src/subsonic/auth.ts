import { createHash, timingSafeEqual } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import type pg from 'pg'
import { readSubsonicPassword } from '../library/password.js'
import { sendErr } from './respond.js'

const USER_KEY = 'subsonicUser'
const DEFAULT_USER = 'tinggui'
const AUTH_FAILED = 'Wrong username or password'

/**
 * 鉴权通过时只交回响应格式，口令不进返回值。
 * 失败时直接交回错误响应，调用方不用再组 40。
 */
export async function requireSubsonic(
  c: Context,
  deps: { dataDir: string; pool: pg.Pool },
): Promise<{ format: 'json' | 'xml' } | Response> {
  const format = c.req.query('f') === 'xml' ? 'xml' : 'json'
  const password = await readSubsonicPassword(deps.dataDir, deps.pool)
  if (password === null) {
    if (isLoopback(c)) return { format }
    return sendErr(c, 40, AUTH_FAILED, format)
  }
  const user = await readUser(deps.pool)
  if ((c.req.query('u') ?? '') !== user) return sendErr(c, 40, AUTH_FAILED, format)
  if (!passwordMatches(c, password)) return sendErr(c, 40, AUTH_FAILED, format)
  return { format }
}

/**
 * 有 x-forwarded-for 或 forwarded 就说明经过了代理。
 * 代理可以改对端地址，所以这时不算回环，避免没设口令时被冒充成本机。
 */
function isLoopback(c: Context): boolean {
  if (c.req.header('x-forwarded-for') !== undefined || c.req.header('forwarded') !== undefined) {
    return false
  }
  const address = getConnInfo(c).remote.address
  return address === '127.0.0.1' || address === '::1'
}

/** 没写用户名时用 tinggui，和产品名对齐，避免空用户名把所有 u 都拒掉。 */
async function readUser(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [USER_KEY],
  )
  const value = result.rows[0]?.value
  if (value === undefined || value.trim() === '') return DEFAULT_USER
  return value
}

/**
 * t 和 s 都在时走 token。客户端的 t 是 md5(口令 + salt) 的十六进制。
 * 缺了其中一个才看 p：enc: 后面是十六进制口令，否则当明文。
 */
function passwordMatches(c: Context, password: string): boolean {
  const token = c.req.query('t')
  const salt = c.req.query('s')
  if (token !== undefined && salt !== undefined) {
    const expected = createHash('md5').update(password + salt, 'utf8').digest('hex')
    return safeEqual(token.toLowerCase(), expected)
  }
  const supplied = c.req.query('p')
  if (supplied === undefined) return false
  const decoded = decodeClientPassword(supplied)
  if (decoded === null) return false
  return safeEqual(decoded, password)
}

function decodeClientPassword(supplied: string): string | null {
  if (!supplied.startsWith('enc:')) return supplied
  const hex = supplied.slice(4)
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null
  return Buffer.from(hex, 'hex').toString('utf8')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
