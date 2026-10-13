import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type pg from 'pg'
import { httpOverHttp, httpsOverHttp } from 'tunnel'
import { pickQuality, QUALITYS } from '../lib/names.js'
import { getSdkProxy } from '../sdk/proxy.js'
import type { MusicInfo, OnlineSource, Quality } from '../types.js'

const PLAY_ERROR = '暂时没有可播放的地址'
/** Range 会连着打几次。地址放内存里，过期再问脚本，避免每次拖动都重新解析。 */
const URL_CACHE_TTL_MS = 8 * 60 * 1000
const BIGINT_MAX = 9223372036854775807n

const PLATFORMS: readonly OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ape': 'audio/x-ape',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
}

/**
 * 脚本当前支持哪些音质。不从 userApi 运行时自己取：
 * 沙箱状态在进程里那一份，由调用方把 getStatus 传进来。
 */
export type ScriptStatus = {
  sources: {
    [platform: string]: { qualitys?: readonly string[] } | undefined
  }
}

export type OpenDeps = {
  pool: pg.Pool
  getMusicUrl: (source: string, musicInfo: MusicInfo, quality: Quality) => Promise<{ type: Quality; url: string }>
  sourceOrder: () => Array<'kw' | 'kg' | 'tx' | 'wy' | 'mg'>
  wantedQuality: () => Quality
  fetchRemote?: (url: string, headers: Record<string, string>) => Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> | null }>
  now?: () => number
  getStatus: () => ScriptStatus
}

type RemoteResult = {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

type SourceRow = {
  platform: string
  platform_song_id: string
  raw: unknown
}

type UrlCacheEntry = {
  url: string
  expiresAt: number
}

/**
 * Feishin 这类客户端把 audio 设成 crossOrigin=anonymous，好接 Web Audio。
 * 响应里没有这些头时，浏览器直接丢掉音频，界面就停在等待。
 */
function applyPlaybackCors(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set(
    'Access-Control-Expose-Headers',
    'Accept-Ranges, Content-Length, Content-Range, Content-Type',
  )
}

function unavailable(): Response {
  const headers = new Headers()
  applyPlaybackCors(headers)
  return Response.json({ error: PLAY_ERROR }, { status: 404, headers })
}

/** 歌曲 id 是 bigint 的十进制文本。非法值直接 404，避免把转换错误抛成 500。 */
function isSongId(songId: string): boolean {
  if (!/^\d+$/.test(songId)) return false
  try {
    const value = BigInt(songId)
    return value >= 0n && value <= BIGINT_MAX
  } catch {
    return false
  }
}

function isPlatform(value: string): value is OnlineSource {
  return (PLATFORMS as readonly string[]).includes(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value) as unknown)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * 没有 raw.id 时按入库规则补上。
 * 酷狗 id 已经是 songmid_hash，再加 kg_ 前缀脚本会对不上。
 */
function musicInfoFrom(platform: OnlineSource, platformSongId: string, raw: unknown): MusicInfo {
  const record = asRecord(raw) ?? {}
  const existingId = record.id
  const id = typeof existingId === 'string' && existingId.length > 0
    ? existingId
    : platform === 'kg'
      ? platformSongId
      : `${platform}_${platformSongId}`
  return {
    id,
    name: typeof record.name === 'string' ? record.name : '',
    singer: typeof record.singer === 'string' ? record.singer : '',
    source: platform,
    // 库里的 interval 有时是 mm:ss。脚本要看原文，这里不改成秒。
    interval: record.interval as MusicInfo['interval'],
    meta: asRecord(record.meta) ?? {},
  }
}

function songQualitiesOf(music: MusicInfo): Partial<Record<Quality, unknown>> {
  const value = music.meta?._qualitys
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Partial<Record<Quality, unknown>>
}

function scriptQualities(status: ScriptStatus, platform: string): Quality[] {
  const listed = status.sources[platform]?.qualitys ?? []
  const known = new Set<string>(QUALITYS)
  return listed.filter((item): item is Quality => known.has(item))
}

/**
 * 从目标音质往更低找，歌曲和脚本都列出的第一档才去取地址。
 * pickQuality 找不到时会落到 128k，那一档两边都不认就不能拿去问脚本。
 */
function chooseQuality(music: MusicInfo, sourceQualities: Quality[], wanted: Quality): Quality | null {
  if (sourceQualities.length === 0) return null
  const songQualities = songQualitiesOf(music)
  const picked = pickQuality(wanted, sourceQualities, songQualities)
  if (!songQualities[picked] || !sourceQualities.includes(picked)) return null
  return picked
}

function contentTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream'
}

function parseRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const matched = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!matched) return null
  const startText = matched[1] ?? ''
  const endText = matched[2] ?? ''
  if (startText === '' && endText === '') return null
  let start = startText === '' ? 0 : Number(startText)
  let end = endText === '' ? size - 1 : Number(endText)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end < start || start >= size) return null
  if (end >= size) end = size - 1
  return { start, end }
}

/**
 * 不转码。扩展名只决定 Content-Type，字节按文件原样送出。
 * 206 的 Content-Length 是这一段的长度，整文件长度写在 Content-Range 的分母。
 */
function serveLocalFile(filePath: string, size: number, rangeHeader: string | undefined): Response {
  const type = contentTypeForPath(filePath)
  const range = parseRange(rangeHeader, size)
  if (range) {
    const { start, end } = range
    const nodeStream = createReadStream(filePath, { start, end })
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
    const headers = new Headers({
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    })
    applyPlaybackCors(headers)
    return new Response(body, { status: 206, headers })
  }

  // 认不出或超出文件的 Range 按整文件送。播放器拿到 200 仍能开声。
  const nodeStream = createReadStream(filePath)
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
  const headers = new Headers({
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size),
  })
  applyPlaybackCors(headers)
  return new Response(body, { status: 200, headers })
}

function cacheKey(songId: string, quality: Quality): string {
  return `${songId}\0${quality}`
}

function getRequestAgent(url: string): http.Agent | https.Agent | undefined {
  const proxy = getSdkProxy()
  if (!proxy) return undefined
  const options = { proxy: { host: proxy.host, port: proxy.port } }
  return /^https:/.test(url) ? httpsOverHttp(options) : httpOverHttp(options)
}

function headersFromNode(nodeHeaders: http.IncomingHttpHeaders): Headers {
  const out = new Headers()
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value == null) continue
    out.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return out
}

function requestOnce(url: string, headers: Record<string, string>): Promise<RemoteResult> {
  return new Promise((resolve, reject) => {
    const mod = /^https:/.test(url) ? https : http
    const req = mod.get(url, { headers, agent: getRequestAgent(url) }, (res) => {
      const status = res.statusCode ?? 0
      const outHeaders = headersFromNode(res.headers)
      // 3xx 先排空再跟跳，避免把连接挂住。
      if (status >= 300 && status < 400) {
        res.resume()
        resolve({ status, headers: outHeaders, body: null })
        return
      }
      const body = Readable.toWeb(res) as ReadableStream<Uint8Array>
      resolve({ status, headers: outHeaders, body })
    })
    req.on('error', reject)
  })
}

/**
 * 与下载走同一条代理。设置里的代理如果只影响刮削，播放会直接连出去。
 * 可注入 fetchRemote，检查时不必打到真实音源。
 */
async function defaultFetchRemote(url: string, headers: Record<string, string>): Promise<RemoteResult> {
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    const remote = await requestOnce(current, headers)
    if (remote.status < 300 || remote.status >= 400) return remote
    const location = remote.headers.get('location')
    if (!location) return remote
    current = new URL(location, current).toString()
  }
  throw new Error('too many redirects')
}

function forwardRemote(remote: RemoteResult): Response {
  const headers = new Headers()
  const contentType = remote.headers.get('content-type')
  const contentRange = remote.headers.get('content-range')
  const contentLength = remote.headers.get('content-length')
  if (contentType) headers.set('Content-Type', contentType)
  if (contentRange) headers.set('Content-Range', contentRange)
  if (contentLength) headers.set('Content-Length', contentLength)
  // 播放器靠这个头才继续发 Range。上游没带时也补上。
  headers.set('Accept-Ranges', 'bytes')
  applyPlaybackCors(headers)
  return new Response(remote.body, { status: remote.status, headers })
}

async function discard(remote: RemoteResult): Promise<void> {
  if (!remote.body) return
  try {
    await remote.body.cancel()
  } catch {
    // 弃用的响应取消失败就不管，不能因此挡住下一条音源。
  }
}

export function createOpenSong(deps: OpenDeps): {
  open(songId: string, rangeHeader: string | undefined): Promise<Response>
} {
  const fetchRemote = deps.fetchRemote ?? defaultFetchRemote
  const now = deps.now ?? Date.now
  const urlCache = new Map<string, UrlCacheEntry>()

  async function readMediaFile(songId: string): Promise<{ path: string; size: number } | null> {
    const found = await deps.pool.query<{ path: string; missing: boolean }>(
      `SELECT path, missing FROM media_files WHERE song_id = $1::bigint`,
      [songId],
    )
    const row = found.rows[0]
    // 标了缺失，或路径已经不在磁盘上：不当作可播放文件。
    // 不把 missing 改成 true。标缺失是扫描的事，这次打不开不能改歌曲行。
    if (!row || row.missing || !existsSync(row.path)) return null
    try {
      const info = statSync(row.path)
      if (!info.isFile()) return null
      return { path: row.path, size: info.size }
    } catch {
      return null
    }
  }

  async function readSources(songId: string): Promise<SourceRow[]> {
    const found = await deps.pool.query<SourceRow>(
      `SELECT platform, platform_song_id, raw
       FROM song_sources
       WHERE song_id = $1::bigint`,
      [songId],
    )
    return found.rows
  }

  function orderSources(rows: SourceRow[], order: readonly OnlineSource[]): SourceRow[] {
    const rank = new Map<OnlineSource, number>()
    order.forEach((platform, index) => {
      if (!rank.has(platform)) rank.set(platform, index)
    })
    return rows
      .map((row, index) => ({ row, index }))
      .filter((item): item is { row: SourceRow & { platform: OnlineSource }; index: number } => (
        isPlatform(item.row.platform) && rank.has(item.row.platform)
      ))
      .sort((a, b) => rank.get(a.row.platform)! - rank.get(b.row.platform)! || a.index - b.index)
      .map((item) => item.row)
  }

  async function resolveUrl(
    songId: string,
    platform: OnlineSource,
    music: MusicInfo,
    quality: Quality,
  ): Promise<string | null> {
    const key = cacheKey(songId, quality)
    const cached = urlCache.get(key)
    if (cached && now() < cached.expiresAt) return cached.url
    urlCache.delete(key)
    try {
      const result = await deps.getMusicUrl(platform, music, quality)
      const url = String(result?.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return null
      urlCache.set(key, { url, expiresAt: now() + URL_CACHE_TTL_MS })
      return url
    } catch {
      urlCache.delete(key)
      return null
    }
  }

  function dropUrl(songId: string, quality: Quality): void {
    urlCache.delete(cacheKey(songId, quality))
  }

  async function fetchPlayable(url: string, rangeHeader: string | undefined): Promise<Response | null> {
    const headers: Record<string, string> = {}
    if (rangeHeader) headers.Range = rangeHeader
    let remote: RemoteResult
    try {
      remote = await fetchRemote(url, headers)
    } catch {
      return null
    }
    // 范围不合法是客户端的问题，换地址也还是 416。
    if (remote.status === 416) return forwardRemote(remote)
    if ((remote.status === 200 || remote.status === 206) && remote.body) return forwardRemote(remote)
    await discard(remote)
    return null
  }

  async function playSource(
    songId: string,
    row: SourceRow,
    status: ScriptStatus,
    wanted: Quality,
    rangeHeader: string | undefined,
  ): Promise<Response | 'next'> {
    if (!isPlatform(row.platform)) return 'next'
    const music = musicInfoFrom(row.platform, row.platform_song_id, row.raw)
    const quality = chooseQuality(music, scriptQualities(status, row.platform), wanted)
    if (!quality) return 'next'

    const firstUrl = await resolveUrl(songId, row.platform, music, quality)
    if (!firstUrl) return 'next'
    const first = await fetchPlayable(firstUrl, rangeHeader)
    if (first) return first

    // 这条地址对端没给音频。丢掉再问一次同一条身份，不换平台。
    dropUrl(songId, quality)
    const secondUrl = await resolveUrl(songId, row.platform, music, quality)
    if (!secondUrl) return 'next'
    const second = await fetchPlayable(secondUrl, rangeHeader)
    if (second) return second
    dropUrl(songId, quality)
    // 这一条身份两条地址都废了，换下一档平台，不要整首放弃。
    return 'next'
  }

  async function open(songId: string, rangeHeader: string | undefined): Promise<Response> {
    if (!isSongId(songId)) return unavailable()

    const file = await readMediaFile(songId)
    if (file) return serveLocalFile(file.path, file.size, rangeHeader)

    const ordered = orderSources(await readSources(songId), deps.sourceOrder())
    if (ordered.length === 0) return unavailable()

    let status: ScriptStatus
    try {
      status = deps.getStatus()
    } catch {
      return unavailable()
    }
    if (!status?.sources) return unavailable()

    const wanted = deps.wantedQuality()
    for (const row of ordered) {
      const played = await playSource(songId, row, status, wanted, rangeHeader)
      if (played === 'next') continue
      return played
    }
    return unavailable()
  }

  return { open }
}
