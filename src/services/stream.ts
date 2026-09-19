import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { httpOverHttp, httpsOverHttp } from 'tunnel'
import type { createRepos } from '../db/repos.js'
import { pickQuality } from '../lib/names.js'
import { getSdkProxy } from '../sdk/proxy.js'
import type { MusicInfo, Quality } from '../types.js'

type Repos = ReturnType<typeof createRepos>

const PLAY_ERROR = '暂时没有可播放的地址'
/** Range 重试间隔短，缓存解析结果避免反复打用户脚本 */
const URL_CACHE_TTL_MS = 8 * 60 * 1000

export type StreamDeps = {
  repos: Repos
  getMusicUrl: (
    source: string,
    musicInfo: MusicInfo,
    quality: Quality,
  ) => Promise<{ type: Quality; url: string }>
  getWantedQuality: () => Quality
  fetchRemote?: (
    url: string,
    headers: Record<string, string>,
  ) => Promise<{
    status: number
    headers: Headers
    body: ReadableStream<Uint8Array> | null
  }>
  /** 测试用：覆盖「现在」 */
  now?: () => number
}

type UrlCacheEntry = {
  url: string
  quality: Quality
  expiresAt: number
}

type RemoteResult = {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

function parseMusicRaw(raw: string | null | undefined): MusicInfo | null {
  if (!raw) return null
  try {
    const info = JSON.parse(raw) as MusicInfo
    if (!info?.id) return null
    return info
  } catch {
    return null
  }
}

function contentTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.flac') return 'audio/flac'
  return 'application/octet-stream'
}

function parseRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!m) return null
  let start = m[1] === '' ? 0 : Number(m[1])
  let end = m[2] === '' ? size - 1 : Number(m[2])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end < start || start >= size) return null
  if (end >= size) end = size - 1
  return { start, end }
}

function songQualitiesOf(
  music: MusicInfo,
  wanted: Quality,
): Partial<Record<Quality, unknown>> {
  const q = music.meta?._qualitys
  if (q && typeof q === 'object') return q as Partial<Record<Quality, unknown>>
  return { [wanted]: true }
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
    const req = mod.get(url, { headers, agent: getRequestAgent(url) }, res => {
      const status = res.statusCode ?? 0
      const outHeaders = headersFromNode(res.headers)
      // 3xx 先排空再跟跳，避免挂死连接
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

/** 与下载器同一条 getSdkProxy / tunnel agent 路径；保留可注入以便测试 */
async function defaultFetchRemote(
  url: string,
  headers: Record<string, string>,
): Promise<RemoteResult> {
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

function playErrorResponse(): Response {
  return Response.json({ error: PLAY_ERROR }, { status: 502 })
}

function serveLocalFile(filePath: string, rangeHeader: string | undefined): Response {
  const size = statSync(filePath).size
  const type = contentTypeForPath(filePath)
  const range = parseRange(rangeHeader, size)

  if (range) {
    const { start, end } = range
    const length = end - start + 1
    const nodeStream = createReadStream(filePath, { start, end })
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(length),
      },
    })
  }

  const nodeStream = createReadStream(filePath)
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size),
    },
  })
}

export function createStreamService(deps: StreamDeps): {
  remember(musicInfo: MusicInfo): void
  resolveMusicInfo(songKey: string): MusicInfo | null
  open(songKey: string, rangeHeader: string | undefined): Promise<Response>
} {
  const remembered = new Map<string, MusicInfo>()
  const urlCache = new Map<string, UrlCacheEntry>()
  const fetchRemote = deps.fetchRemote ?? defaultFetchRemote
  const now = deps.now ?? Date.now

  function remember(musicInfo: MusicInfo): void {
    remembered.set(musicInfo.id, musicInfo)
  }

  function resolveMusicInfo(songKey: string): MusicInfo | null {
    const cached = remembered.get(songKey)
    if (cached) return cached

    const download = deps.repos.downloads.get(songKey)
    const fromDownload = parseMusicRaw(download?.raw)
    if (fromDownload) return fromDownload

    const track = deps.repos.tracks.findBySongKey(songKey)
    return parseMusicRaw(track?.raw)
  }

  function readUrlCache(songKey: string, quality: Quality): string | null {
    const entry = urlCache.get(songKey)
    if (!entry) return null
    if (entry.quality !== quality || now() > entry.expiresAt) {
      urlCache.delete(songKey)
      return null
    }
    return entry.url
  }

  function writeUrlCache(songKey: string, quality: Quality, url: string): void {
    urlCache.set(songKey, { url, quality, expiresAt: now() + URL_CACHE_TTL_MS })
  }

  function invalidateUrlCache(songKey: string): void {
    urlCache.delete(songKey)
  }

  async function open(songKey: string, rangeHeader: string | undefined): Promise<Response> {
    const download = deps.repos.downloads.get(songKey)
    if (download?.file_path && existsSync(download.file_path)) {
      return serveLocalFile(download.file_path, rangeHeader)
    }

    const musicInfo = resolveMusicInfo(songKey)
    if (!musicInfo) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    const wanted = deps.getWantedQuality()
    const quality = pickQuality(
      wanted,
      [wanted, '320k', '128k'],
      songQualitiesOf(musicInfo, wanted),
    )

    let url = readUrlCache(songKey, quality)
    if (!url) {
      try {
        const result = await deps.getMusicUrl(String(musicInfo.source), musicInfo, quality)
        url = String(result?.url || '')
      } catch {
        invalidateUrlCache(songKey)
        return playErrorResponse()
      }

      if (!url || !/^https?:/i.test(url)) {
        invalidateUrlCache(songKey)
        return playErrorResponse()
      }
      writeUrlCache(songKey, quality, url)
    }

    const headers: Record<string, string> = {}
    if (rangeHeader) headers.Range = rangeHeader

    try {
      const remote = await fetchRemote(url, headers)
      const outHeaders = new Headers()
      const contentType = remote.headers.get('Content-Type')
      const contentRange = remote.headers.get('Content-Range')
      const contentLength = remote.headers.get('Content-Length')
      if (contentType) outHeaders.set('Content-Type', contentType)
      if (contentRange) outHeaders.set('Content-Range', contentRange)
      if (contentLength) outHeaders.set('Content-Length', contentLength)
      outHeaders.set('Accept-Ranges', 'bytes')
      return new Response(remote.body, { status: remote.status, headers: outHeaders })
    } catch {
      invalidateUrlCache(songKey)
      return playErrorResponse()
    }
  }

  return { remember, resolveMusicInfo, open }
}
