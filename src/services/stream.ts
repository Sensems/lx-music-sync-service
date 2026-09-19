import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { createRepos } from '../db/repos.js'
import { pickQuality } from '../lib/names.js'
import type { MusicInfo, Quality } from '../types.js'

type Repos = ReturnType<typeof createRepos>

const PLAY_ERROR = '暂时没有可播放的地址'

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

async function defaultFetchRemote(
  url: string,
  headers: Record<string, string>,
): Promise<{
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}> {
  const res = await fetch(url, { headers })
  return {
    status: res.status,
    headers: res.headers,
    body: res.body as ReadableStream<Uint8Array> | null,
  }
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
  const fetchRemote = deps.fetchRemote ?? defaultFetchRemote

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

    let url = ''
    try {
      const result = await deps.getMusicUrl(String(musicInfo.source), musicInfo, quality)
      url = String(result?.url || '')
    } catch {
      return playErrorResponse()
    }

    if (!url || !/^https?:/i.test(url)) {
      return playErrorResponse()
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
      return playErrorResponse()
    }
  }

  return { remember, resolveMusicInfo, open }
}
