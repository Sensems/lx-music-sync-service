import { existsSync } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { downloadFile } from '../download/downloader.js'
import type { MusicInfo, OnlineSource } from '../types.js'

const BIGINT_MAX = 9223372036854775807n

/**
 * 和播放挑平台的默认顺序一样。
 * 这两个函数的参数里没有 sourceOrder，设置里的自定义顺序要等调用方以后传进来。
 */
const SOURCE_ORDER: readonly OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']

type SourceRow = {
  platform: string
  platform_song_id: string
  raw: unknown
}

function isLibraryId(id: string): boolean {
  if (!/^\d+$/.test(id)) return false
  try {
    const value = BigInt(id)
    return value >= 0n && value <= BIGINT_MAX
  } catch {
    return false
  }
}

function isPlatform(value: string): value is OnlineSource {
  return (SOURCE_ORDER as readonly string[]).includes(value)
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^https?:\/\//i.test(text)) return null
  return text
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
    interval: record.interval as MusicInfo['interval'],
    meta: asRecord(record.meta) ?? {},
  }
}

/** 多条平台身份时只取默认顺序里最靠前的一条，和播放先问谁一致。 */
function pickSource(rows: SourceRow[]): SourceRow | null {
  const rank = new Map<string, number>(SOURCE_ORDER.map((platform, index) => [platform, index]))
  const ordered = rows
    .map((row, index) => ({ row, index, place: rank.get(row.platform) }))
    .filter((item): item is { row: SourceRow; index: number; place: number } => item.place != null)
    .sort((a, b) => a.place - b.place || a.index - b.index)
  return ordered[0]?.row ?? null
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

async function unlinkQuiet(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {})
}

/**
 * downloadFile 发现目标已经在磁盘上就直接返回，不会换成新的字节。
 * 封面只写这一张专辑自己的路径。
 */
async function writeDownload(url: string, destPath: string): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true })
  const incoming = `${destPath}.incoming`
  await unlinkQuiet(incoming)
  await downloadFile({ url, destPath: incoming })
  const info = await stat(incoming)
  if (!info.isFile() || info.size <= 0) {
    await unlinkQuiet(incoming)
    throw new Error('下载没有得到文件')
  }
  if (existsSync(destPath)) await unlink(destPath)
  await rename(incoming, destPath)
}

async function readSources(pool: pg.Pool, songId: string): Promise<SourceRow[]> {
  const found = await pool.query<SourceRow>(
    `SELECT platform, platform_song_id, raw
     FROM song_sources
     WHERE song_id = $1::bigint`,
    [songId],
  )
  return found.rows
}

function musicFromSources(rows: SourceRow[]): MusicInfo | null {
  const row = pickSource(rows)
  if (!row || !isPlatform(row.platform)) return null
  return musicInfoFrom(row.platform, row.platform_song_id, row.raw)
}

/**
 * 专辑封面。已有文件就直接用。
 * 没有文件时只问这一张专辑的第一首，失败就返回 null，不改歌曲行。
 */
export async function coverFile(opts: {
  pool: pg.Pool
  albumId: string
  dataDir: string
  fetchPic: (music: MusicInfo) => Promise<string | null>
}): Promise<{ path: string } | null> {
  if (!isLibraryId(opts.albumId)) return null

  const album = await opts.pool.query<{ cover_path: string }>(
    `SELECT cover_path FROM albums WHERE id = $1::bigint`,
    [opts.albumId],
  )
  const coverPath = album.rows[0]?.cover_path
  if (coverPath == null) return null
  if (coverPath.length > 0 && (await fileExists(coverPath))) return { path: coverPath }

  // 没有音轨号的歌不该排到有号的前面。第一首没有平台身份就不再往下找。
  const first = await opts.pool.query<{ id: string }>(
    `SELECT id::text AS id
     FROM songs
     WHERE album_id = $1::bigint
     ORDER BY disc_no ASC NULLS LAST, track_no ASC NULLS LAST, id ASC
     LIMIT 1`,
    [opts.albumId],
  )
  const songId = first.rows[0]?.id
  if (!songId) return null
  const music = musicFromSources(await readSources(opts.pool, songId))
  if (!music) return null

  let pic: string | null
  try {
    pic = httpUrl(await opts.fetchPic(music))
  } catch {
    return null
  }
  if (!pic) return null

  // 不带扩展名。同一张专辑换图时路径不变，cover_path 才对得上。
  const destPath = path.resolve(opts.dataDir, 'covers', opts.albumId)
  try {
    await writeDownload(pic, destPath)
  } catch {
    return null
  }
  const written = await fileExists(destPath)
  if (!written) return null

  await opts.pool.query(
    `UPDATE albums SET cover_path = $2 WHERE id = $1::bigint`,
    [opts.albumId, destPath],
  )
  return { path: destPath }
}

/**
 * 歌词已经在歌曲行上就不再刮。
 * 刮一次，成功才写入；失败返回空字符串，不改这一行。
 */
export async function lyricText(opts: {
  pool: pg.Pool
  songId: string
  fetchLyric: (music: MusicInfo) => Promise<{ lyric: string; tlyric: string }>
}): Promise<{ lyric: string; tlyric: string }> {
  const empty = { lyric: '', tlyric: '' }
  if (!isLibraryId(opts.songId)) return empty

  const found = await opts.pool.query<{ lyric: string; tlyric: string }>(
    `SELECT lyric, tlyric FROM songs WHERE id = $1::bigint`,
    [opts.songId],
  )
  const row = found.rows[0]
  if (!row) return empty
  // 只有空白不算已经有词，否则刮失败留下的空格会挡住以后再刮。
  if (row.lyric.trim().length > 0) return { lyric: row.lyric, tlyric: row.tlyric }

  const music = musicFromSources(await readSources(opts.pool, opts.songId))
  if (!music) return empty

  let scraped: { lyric: string; tlyric: string }
  try {
    scraped = await opts.fetchLyric(music)
  } catch {
    return empty
  }
  const lyric = typeof scraped?.lyric === 'string' ? scraped.lyric : ''
  const tlyric = typeof scraped?.tlyric === 'string' ? scraped.tlyric : ''
  if (lyric.trim().length === 0) return empty

  await opts.pool.query(
    `UPDATE songs SET lyric = $2, tlyric = $3 WHERE id = $1::bigint`,
    [opts.songId, lyric, tlyric],
  )
  return { lyric, tlyric }
}
