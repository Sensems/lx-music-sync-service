import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseFile, type IAudioMetadata, type ICommonTagsResult } from 'music-metadata'
import type { PoolClient } from 'pg'
import type { OnlineSource } from '../types.js'
import { collapseSpace, durationMs, splitSingers } from './normalize.js'
import { findMediumMatch, insertSongWithoutSource } from './upsert.js'

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ape', '.m4a', '.ogg', '.aac'])

const SOURCE_COMMENT = /^tinggui:(kw|kg|tx|wy|mg):(.+)$/
const PG_INT_MAX = 2_147_483_647

type ScanCounts = {
  added: number
  updated: number
  unmerged: string[]
  unreadable: string[]
}

/**
 * 扩展名决定音质。无损只认 flac / wav / ape，其余都按 mp3 记，
 * 避免把 m4a、ogg 写成库里不存在的音质档。
 */
function qualityFor(ext: string): string {
  if (ext === '.flac') return 'flac'
  if (ext === '.wav') return 'wav'
  if (ext === '.ape') return 'ape'
  return 'mp3'
}

function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 同一路径或它的子项。`music` 不会把 `music-other` 算进去。 */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(pathKey(parent), pathKey(child))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

async function canonical(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

function wholeNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value < 0) return null
  return value
}

/**
 * format.duration 是秒。duration_ms 是 integer，超界或非正数就当没有时长，
 * 这样中等匹配不会拿 0 去并歌，也不会把扫描整段打崩。
 */
function tagDurationMs(seconds: number | undefined): number | null {
  const ms = durationMs(seconds)
  if (ms == null || ms <= 0 || ms > PG_INT_MAX) return null
  return ms
}

function splitMany(values: readonly string[] | undefined): string[] {
  if (!values) return []
  const names: string[] = []
  for (const value of values) names.push(...splitSingers(value))
  return names
}

/** 专辑歌手放前面。第一位才是 albums 上的专辑歌手，其余进 song_artists。 */
function orderedSingers(albumArtists: string[], trackSingers: string[]): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const name of [...albumArtists, ...trackSingers]) {
    if (seen.has(name)) continue
    seen.add(name)
    ordered.push(name)
  }
  return ordered
}

function sourceFromComments(
  comments: ICommonTagsResult['comment'],
): { platform: OnlineSource; platformSongId: string } | null {
  if (!comments) return null
  for (const comment of comments) {
    const text = comment.text?.replace(/\0+$/g, '').trim()
    if (!text) continue
    const matched = SOURCE_COMMENT.exec(text)
    const platform = matched?.[1]
    const platformSongId = matched?.[2]?.trim()
    if (!platform || !platformSongId) continue
    if (platform !== 'kw' && platform !== 'kg' && platform !== 'tx' && platform !== 'wy' && platform !== 'mg') {
      continue
    }
    return { platform, platformSongId }
  }
  return null
}

async function findSourceSong(
  client: PoolClient,
  platform: OnlineSource,
  platformSongId: string,
): Promise<string | null> {
  const found = await client.query<{ song_id: string }>(
    `SELECT song_id::text AS song_id
     FROM song_sources
     WHERE platform = $1 AND platform_song_id = $2`,
    [platform, platformSongId],
  )
  return found.rows[0]?.song_id ?? null
}

type FileStat = {
  path: string
  size: number
  mtimeMs: number
  quality: string
}

async function attachFile(
  client: PoolClient,
  songId: string,
  file: FileStat,
  unmerged: string[],
): Promise<'added' | 'updated' | 'unmerged' | 'kept'> {
  const existing = await client.query<{ path: string; missing: boolean }>(
    `SELECT path, missing FROM media_files WHERE song_id = $1::bigint`,
    [songId],
  )
  const row = existing.rows[0]
  if (!row) {
    await client.query(
      `INSERT INTO media_files (song_id, path, size, mtime_ms, quality, missing)
       VALUES ($1::bigint, $2, $3, $4, $5, false)`,
      [songId, file.path, file.size, file.mtimeMs, file.quality],
    )
    return 'added'
  }

  if (pathKey(row.path) === pathKey(file.path)) {
    if (!row.missing) return 'kept'
    await replaceFile(client, songId, file)
    return 'updated'
  }

  // 原文件还在就保留原路径。这首歌只能有一个当前文件，新文件留给调用方看 unmerged。
  const present = row.missing === false && (await fileExists(row.path))
  if (present) {
    unmerged.push(file.path)
    return 'unmerged'
  }

  await replaceFile(client, songId, file)
  return 'updated'
}

async function replaceFile(client: PoolClient, songId: string, file: FileStat): Promise<void> {
  await client.query(
    `UPDATE media_files
     SET path = $2, size = $3, mtime_ms = $4, quality = $5, missing = false
     WHERE song_id = $1::bigint`,
    [songId, file.path, file.size, file.mtimeMs, file.quality],
  )
}

async function resolveSong(client: PoolClient, metadata: IAudioMetadata): Promise<string> {
  const source = sourceFromComments(metadata.common.comment)
  if (source) {
    const strongId = await findSourceSong(client, source.platform, source.platformSongId)
    if (strongId) return strongId
    // 注释对上了格式，库里还没有这条平台身份。不补 song_sources，接着按标签并或新建。
  }

  const title = collapseSpace(metadata.common.title ?? '')
  const albumTitle = collapseSpace(metadata.common.album ?? '')
  const album = splitMany(metadata.common.albumartists)
  const albumFromTag = album.length > 0 ? album : splitMany(
    metadata.common.albumartist ? [metadata.common.albumartist] : undefined,
  )
  const tracks = splitMany(metadata.common.artists)
  const trackFromTag = tracks.length > 0 ? tracks : splitSingers(metadata.common.artist ?? '')
  const singers = orderedSingers(albumFromTag, trackFromTag)
  const albumArtist = singers[0] ?? ''
  const duration = tagDurationMs(metadata.format.duration)

  if (title.length > 0 && albumTitle.length > 0 && albumArtist.length > 0 && duration != null) {
    const mediumId = await findMediumMatch(client, {
      title,
      albumTitle,
      albumArtist,
      durationMs: duration,
    })
    if (mediumId) return mediumId
  }

  const created = await insertSongWithoutSource(client, {
    title,
    singers,
    albumTitle,
    durationMs: duration,
    trackNo: wholeNumber(metadata.common.track?.no),
    discNo: wholeNumber(metadata.common.disk?.no),
  })
  return created.songId
}

/**
 * 扫一个根目录。调用方负责事务：这里不开 BEGIN，目录读失败会抛出，
 * 这样半路列不出子目录时不会把没走到的文件标成缺失。
 * 缓存目录里的文件跳过。缓存是播放落盘，再入库会变成另一首歌。
 */
export async function scanRoot(
  client: PoolClient,
  rootPath: string,
  cacheDir: string,
): Promise<ScanCounts> {
  const rootResolved = path.resolve(rootPath)
  const cacheResolved = path.resolve(cacheDir)
  const rootInfo = await stat(rootResolved)
  if (!rootInfo.isDirectory()) throw new Error('library root is not a directory')

  const rootReal = (await canonical(rootResolved)) ?? rootResolved
  const cacheReal = (await canonical(cacheResolved)) ?? cacheResolved

  const counts: ScanCounts = { added: 0, updated: 0, unmerged: [], unreadable: [] }
  const seenPaths = new Set<string>()
  const seenReals = new Set<string>()
  const visited = new Set<string>([pathKey(rootReal)])

  const underRoot = (filePath: string): boolean =>
    isInside(filePath, rootResolved) || isInside(filePath, rootReal)
  const underCache = (filePath: string): boolean =>
    isInside(filePath, cacheResolved) || isInside(filePath, cacheReal)

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (!isDir && !isFile) {
        if (!entry.isSymbolicLink()) continue
        try {
          const info = await stat(full)
          isDir = info.isDirectory()
          isFile = info.isFile()
        } catch {
          continue
        }
      }
      if (isDir) {
        const real = await canonical(full)
        // 真实路径拿不到也要继续往下走。跳过这一层会让里面的文件被标成缺失。
        if (underCache(full) || (real != null && underCache(real))) continue
        const key = pathKey(real ?? full)
        if (visited.has(key)) continue
        visited.add(key)
        await walk(full)
        continue
      }
      if (isFile) await consider(full)
    }
  }

  const consider = async (full: string): Promise<void> => {
    const ext = path.extname(full).toLowerCase()
    if (!AUDIO_EXT.has(ext)) return

    const storedPath = path.resolve(full)
    let info
    try {
      info = await stat(full)
    } catch {
      return
    }
    if (!info.isFile()) return

    const real = await canonical(full)
    if (!real) {
      // 文件还在，但真实路径拿不到，分不清是不是缓存。不入库，也不能标成缺失。
      seenPaths.add(pathKey(storedPath))
      counts.unreadable.push(storedPath)
      return
    }
    if (underCache(storedPath) || underCache(real)) return

    seenPaths.add(pathKey(storedPath))
    const realKey = pathKey(real)
    // 硬链接或符号链接指向同一文件时，只处理第一次见到的路径。
    if (seenReals.has(realKey)) return
    seenReals.add(realKey)

    const file: FileStat = {
      path: storedPath,
      size: info.size,
      mtimeMs: Math.round(info.mtimeMs),
      quality: qualityFor(ext),
    }

    let metadata: IAudioMetadata | undefined
    try {
      // duration 要读完才有毫秒，中等匹配靠它。封面不参与扫描，跳过以免把图片读进内存。
      metadata = await parseFile(storedPath, { duration: true, skipCovers: true })
    } catch {
      metadata = undefined
    }
    // 扩展名像音频，但解析器没有认出音轨。不要把损坏文件收成「未知歌曲」。
    // 读失败就不改任何行。文件已经记进 seen，收尾时也不会被标成缺失。
    if (!metadata || metadata.format.hasAudio !== true) {
      counts.unreadable.push(storedPath)
      return
    }

    const byPath = await client.query<{ missing: boolean }>(
      `SELECT missing FROM media_files WHERE path = $1`,
      [storedPath],
    )
    if (byPath.rows.length > 0) {
      // 同一路径再次扫到就是原来的文件，不能再建一首。缺了再出现则把缺失清掉。
      if (byPath.rows.some((row) => row.missing)) {
        const written = await client.query(
          `UPDATE media_files
           SET size = $2, mtime_ms = $3, quality = $4, missing = false
           WHERE path = $1 AND missing = true`,
          [storedPath, file.size, file.mtimeMs, file.quality],
        )
        counts.updated += written.rowCount ?? 0
      }
      return
    }

    const songId = await resolveSong(client, metadata)
    const outcome = await attachFile(client, songId, file, counts.unmerged)
    if (outcome === 'added') counts.added += 1
    else if (outcome === 'updated') counts.updated += 1
  }

  await walk(rootResolved)

  const rows = await client.query<{ song_id: string; path: string }>(
    `SELECT song_id::text AS song_id, path
     FROM media_files
     WHERE missing = false`,
  )
  const missingIds: string[] = []
  for (const row of rows.rows) {
    if (!underRoot(row.path) || underCache(row.path)) continue
    if (seenPaths.has(pathKey(row.path))) continue
    const real = await canonical(row.path)
    if (real && (underCache(real) || seenReals.has(pathKey(real)))) continue
    missingIds.push(row.song_id)
  }
  if (missingIds.length > 0) {
    // 只标缺失，不删 songs。歌还在，只是文件不在这个根里了。
    await client.query(
      `UPDATE media_files SET missing = true WHERE song_id = ANY($1::bigint[])`,
      [missingIds],
    )
  }

  return counts
}
