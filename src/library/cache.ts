import { existsSync } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { downloadFile } from '../download/downloader.js'
import { getExt } from '../lib/names.js'
import type { Quality } from '../types.js'

const BIGINT_MAX = 9223372036854775807n

/** 歌曲 id 是 bigint 的十进制文本。非法值不要送进 SQL，转换错误会变成整次缓存失败。 */
function isLibraryId(id: string): boolean {
  if (!/^\d+$/.test(id)) return false
  try {
    const value = BigInt(id)
    return value >= 0n && value <= BIGINT_MAX
  } catch {
    return false
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
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
 * 先落到旁边，确认有内容再换上这一首自己的路径。只卸这个目标，不碰别的歌的文件。
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

/**
 * 缓存是单独动作。订阅刷新只改歌单成员，不会调用这里，
 * 文件写在 cacheDir，扫描会跳过这个目录，避免再收成另一首歌。
 */
export async function cacheSong(opts: {
  pool: pg.Pool
  songId: string
  cacheDir: string
  replace: boolean
  resolveUrl: (songId: string) => Promise<{ url: string; quality: Quality } | null>
}): Promise<{ path: string } | { skipped: 'has-file' }> {
  if (!isLibraryId(opts.songId)) throw new Error('歌曲不存在')

  const existing = await opts.pool.query<{ path: string; missing: boolean }>(
    `SELECT path, missing FROM media_files WHERE song_id = $1::bigint`,
    [opts.songId],
  )
  const row = existing.rows[0]
  // 标记没缺但路径已经不在，就当没有文件。否则会一直跳过，播放时又找不到。
  if (!opts.replace && row && row.missing === false && (await fileExists(row.path))) {
    return { skipped: 'has-file' }
  }

  const present = await opts.pool.query(`SELECT 1 FROM songs WHERE id = $1::bigint`, [opts.songId])
  if ((present.rowCount ?? 0) === 0) throw new Error('歌曲不存在')

  const resolved = await opts.resolveUrl(opts.songId)
  const url = resolved?.url?.trim() ?? ''
  if (!resolved || !isHttpUrl(url)) throw new Error('没有可缓存的地址')

  const destPath = path.resolve(opts.cacheDir, `${opts.songId}.${getExt(resolved.quality)}`)
  await writeDownload(url, destPath)
  const info = await stat(destPath)
  if (!info.isFile() || info.size <= 0) throw new Error('下载没有得到文件')

  await opts.pool.query(
    `INSERT INTO media_files (song_id, path, size, mtime_ms, quality, missing)
     VALUES ($1::bigint, $2, $3, $4, $5, false)
     ON CONFLICT (song_id) DO UPDATE
     SET path = EXCLUDED.path,
         size = EXCLUDED.size,
         mtime_ms = EXCLUDED.mtime_ms,
         quality = EXCLUDED.quality,
         missing = false`,
    [opts.songId, destPath, info.size, Math.round(info.mtimeMs), resolved.quality],
  )
  return { path: destPath }
}

/** 按歌单顺序逐首缓存。一首失败只记失败，继续后面的，也不删已经缓存的文件。 */
export async function cachePlaylist(opts: {
  pool: pg.Pool
  playlistId: string
  cacheDir: string
  replace: boolean
  resolveUrl: (songId: string) => Promise<{ url: string; quality: Quality } | null>
}): Promise<{ cached: number; skipped: number; failed: number }> {
  if (!isLibraryId(opts.playlistId)) throw new Error('歌单不存在')

  const found = await opts.pool.query<{ song_id: string }>(
    `SELECT song_id::text AS song_id
     FROM playlist_items
     WHERE playlist_id = $1::bigint
     ORDER BY position ASC`,
    [opts.playlistId],
  )

  let cached = 0
  let skipped = 0
  let failed = 0
  for (const row of found.rows) {
    try {
      const result = await cacheSong({
        pool: opts.pool,
        songId: row.song_id,
        cacheDir: opts.cacheDir,
        replace: opts.replace,
        resolveUrl: opts.resolveUrl,
      })
      if ('skipped' in result) skipped += 1
      else cached += 1
    } catch {
      failed += 1
    }
  }
  return { cached, skipped, failed }
}
