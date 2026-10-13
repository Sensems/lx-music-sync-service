import { lookup } from 'node:dns/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { BlockList, isIP } from 'node:net'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { MusicInfo } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'

export type AppCtx = {
  dataDir: string
  runtime: {
    load(script: string): Promise<SourceStatus>
    getStatus(): SourceStatus
    setProxy(proxy: { host: string; port: number } | null): void
  }
}

function asMusicInfo(body: Record<string, unknown>): MusicInfo | null {
  if (body.musicInfo && typeof body.musicInfo === 'object') {
    return body.musicInfo as MusicInfo
  }
  const source = body.source
  const id = body.id
  if (typeof source === 'string' && (typeof id === 'string' || typeof id === 'number')) {
    const platformId = String(id)
    const songKey = platformId.includes('_') ? platformId : `${source}_${platformId}`
    return {
      id: songKey,
      name: platformId,
      singer: '',
      source: source as MusicInfo['source'],
      interval: null,
      meta: {},
    }
  }
  return null
}

function cleanPicUrl(raw: unknown): string {
  const s = String(raw || '').trim()
  return !s || s === 'null' || s === 'undefined' ? '' : s
}

/** 社区脚本通常几百 KB。上限挡住把内网大文件拖进进程。 */
const SCRIPT_MAX_BYTES = 2 * 1024 * 1024
const SCRIPT_FETCH_MS = 30_000
const SCRIPT_REDIRECTS = 3

const blockedHosts = new BlockList()
blockedHosts.addSubnet('0.0.0.0', 8, 'ipv4')
blockedHosts.addSubnet('10.0.0.0', 8, 'ipv4')
blockedHosts.addSubnet('100.64.0.0', 10, 'ipv4')
blockedHosts.addSubnet('127.0.0.0', 8, 'ipv4')
blockedHosts.addSubnet('169.254.0.0', 16, 'ipv4')
blockedHosts.addSubnet('172.16.0.0', 12, 'ipv4')
blockedHosts.addSubnet('192.168.0.0', 16, 'ipv4')
blockedHosts.addSubnet('224.0.0.0', 4, 'ipv4')
blockedHosts.addSubnet('240.0.0.0', 4, 'ipv4')
blockedHosts.addAddress('::', 'ipv6')
blockedHosts.addAddress('::1', 'ipv6')
blockedHosts.addSubnet('fc00::', 7, 'ipv6')
blockedHosts.addSubnet('fe80::', 10, 'ipv6')
blockedHosts.addSubnet('ff00::', 8, 'ipv6')

function ipBlocked(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return blockedHosts.check(ip, 'ipv4')
  if (kind !== 6) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped?.[1]) return ipBlocked(mapped[1])
  return blockedHosts.check(ip, 'ipv6')
}

function hostNameBlocked(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  // 十进制或十六进制的 IP 写法会绕过 isIP，例如 2130706433 就是 127.0.0.1。
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true
  return false
}

/** 解析后再判断。重定向的每一跳都要再过一遍，不能只看用户最初粘贴的地址。 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('invalid url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) urls are allowed')
  }
  if (parsed.username || parsed.password || hostNameBlocked(parsed.hostname)) {
    throw new Error('url host is not allowed')
  }
  if (isIP(parsed.hostname)) {
    if (ipBlocked(parsed.hostname)) throw new Error('url host is not allowed')
    return parsed
  }
  let records: { address: string }[]
  try {
    records = await lookup(parsed.hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('url host is not allowed')
  }
  if (records.length === 0 || records.some((record) => ipBlocked(record.address))) {
    throw new Error('url host is not allowed')
  }
  return parsed
}

async function readScriptBody(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > SCRIPT_MAX_BYTES) {
    throw new Error('script is too large')
  }
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    if (Buffer.byteLength(text) > SCRIPT_MAX_BYTES) throw new Error('script is too large')
    return text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > SCRIPT_MAX_BYTES) {
        await reader.cancel()
        throw new Error('script is too large')
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 取消读取后锁可能已经放开。不要让它盖住「脚本太大」。
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function downloadPublicScript(rawUrl: string): Promise<string> {
  let current = rawUrl
  for (let hop = 0; hop <= SCRIPT_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SCRIPT_FETCH_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { Accept: 'text/plain, application/javascript, */*' },
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel()
        if (!location) throw new Error('redirect without location')
        current = new URL(location, url).toString()
        continue
      }
      if (!res.ok) throw new Error(`download failed: ${res.status}`)
      const script = await readScriptBody(res)
      if (!script.trim()) throw new Error('empty script')
      return script
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('too many redirects')
}

function lyricDisplayFields(musicInfo: MusicInfo) {
  return {
    name: musicInfo.name,
    singer: musicInfo.singer,
    source: musicInfo.source,
    picUrl: cleanPicUrl(musicInfo.meta?.picUrl),
  }
}

async function lyricPayload(songKey: string, musicInfo: MusicInfo) {
  const { getLyricForMusic } = await import('../services/lyrics.js')
  const { ensureMusicPic } = await import('../services/pic.js')
  // 已有封面就不要再打一次平台；歌词失败时仍把封面带回去。
  const [enriched, lyric] = await Promise.all([
    cleanPicUrl(musicInfo.meta?.picUrl) ? musicInfo : ensureMusicPic(musicInfo).catch(() => musicInfo),
    getLyricForMusic(musicInfo).catch(() => ({ lyric: '', tlyric: '' })),
  ])
  return {
    songKey,
    ...lyricDisplayFields(enriched),
    lyric: lyric.lyric || '',
    tlyric: lyric.tlyric || '',
  }
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    /* empty */
  }
  return {}
}

export function createApp(ctx: AppCtx): Hono {
  const app = new Hono()
  const { runtime, dataDir } = ctx

  // 接口响应不能进浏览器缓存。曾经有人把首页 HTML 当成 /api/jobs 的 200 缓存下来。
  app.use('/api/*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/api/source/status', (c) => {
    return c.json(runtime.getStatus())
  })

  app.post('/api/lyrics', async (c) => {
    const body = await readJson(c)
    const musicInfo = asMusicInfo(body)
    const songKey = typeof body.songKey === 'string' ? body.songKey : musicInfo?.id
    if (!musicInfo?.id || !songKey) return c.json({ error: 'musicInfo or songKey required' }, 400)
    return c.json(await lyricPayload(songKey, musicInfo))
  })

  app.post('/api/settings/user-api', async (c) => {
    const body = await c.req.parseBody()
    const file = body.file
    if (!file || typeof file === 'string') {
      return c.json({ error: 'file required' }, 400)
    }
    const script = await (file as File).text()
    const dir = join(dataDir, 'user-api')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'current.js'), script, 'utf8')
    const status = await runtime.load(script)
    return c.json(status)
  })

  app.post('/api/settings/user-api/url', async (c) => {
    const body = await readJson(c)
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
    if (!rawUrl) {
      return c.json({ error: 'url required' }, 400)
    }
    try {
      const script = await downloadPublicScript(rawUrl)
      const dir = join(dataDir, 'user-api')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'current.js'), script, 'utf8')
      const status = await runtime.load(script)
      return c.json(status)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 400)
    }
  })

  return app
}
