import { unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Pool, PoolClient } from 'pg'

/** 任务页只看最近这些条。更早的成功和失败可以删，排队中的不能动。 */
const KEEP_FINISHED_JOBS = 100
/** 播放次数按还留着的 scrobble 计。太早的记录拿掉，避免这张表一直涨。 */
const KEEP_SCROBBLES = 20_000

export type TidyResult = {
  removedSongs: number
  clearedFiles: number
  trimmedJobs: number
  trimmedScrobbles: number
}

function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 只删缓存目录里的文件。扫进来的原文件留在用户的磁盘上。 */
function isInsideCache(filePath: string, cacheDir: string): boolean {
  const rel = path.relative(pathKey(cacheDir), pathKey(filePath))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

async function unlinkCacheFile(filePath: string, cacheDir: string): Promise<void> {
  if (!isInsideCache(filePath, cacheDir)) return
  await unlink(filePath).catch(() => {})
}

/**
 * 空专辑和不再被任何歌引用的歌手会留在 Subsonic 里变成空目录。
 * 删歌之后顺手收掉。收藏挂在这些 id 上，要先于行本身删。
 */
async function pruneEmpty(client: PoolClient): Promise<void> {
  await client.query(
    `DELETE FROM stars
     WHERE target_type = 'album'
       AND NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = stars.target_id)`,
  )
  await client.query(
    `DELETE FROM album_sources
     WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = album_sources.album_id)`,
  )
  await client.query(
    `DELETE FROM albums al
     WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = al.id)`,
  )
  await client.query(
    `DELETE FROM stars
     WHERE target_type = 'artist'
       AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.album_artist_id = stars.target_id)
       AND NOT EXISTS (SELECT 1 FROM song_artists sa WHERE sa.artist_id = stars.target_id)`,
  )
  await client.query(
    `DELETE FROM artists ar
     WHERE NOT EXISTS (SELECT 1 FROM albums al WHERE al.album_artist_id = ar.id)
       AND NOT EXISTS (SELECT 1 FROM song_artists sa WHERE sa.artist_id = ar.id)`,
  )
}

/** 歌单成员和播放记录没有 ON DELETE CASCADE，要在删歌曲行之前清掉。 */
async function deleteSongRows(client: PoolClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await client.query(`DELETE FROM playlist_items WHERE song_id = ANY($1::bigint[])`, [ids])
  await client.query(`DELETE FROM scrobbles WHERE song_id = ANY($1::bigint[])`, [ids])
  await client.query(
    `DELETE FROM stars WHERE target_type = 'song' AND target_id = ANY($1::bigint[])`,
    [ids],
  )
  await client.query(`DELETE FROM songs WHERE id = ANY($1::bigint[])`, [ids])
  await pruneEmpty(client)
}

export async function deleteSong(pool: Pool, songId: string, cacheDir: string): Promise<boolean> {
  const client = await pool.connect()
  let cachePath: string | null = null
  try {
    await client.query('BEGIN')
    const found = await client.query<{ path: string }>(
      `SELECT mf.path
       FROM songs s
       LEFT JOIN media_files mf ON mf.song_id = s.id
       WHERE s.id = $1::bigint`,
      [songId],
    )
    if ((found.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK')
      return false
    }
    cachePath = found.rows[0]?.path ?? null
    await deleteSongRows(client, [songId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  if (cachePath) await unlinkCacheFile(cachePath, cacheDir)
  return true
}

/**
 * 缺失且没有平台身份的歌没法再播，整首去掉。
 * 还有音源身份的只清掉失效文件记录，歌还在，下次播放走音源。
 */
export async function tidyLibrary(pool: Pool): Promise<TidyResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const doomed = await client.query<{ id: string }>(
      `SELECT s.id::text AS id
       FROM songs s
       JOIN media_files mf ON mf.song_id = s.id
       WHERE mf.missing = true
         AND NOT EXISTS (SELECT 1 FROM song_sources ss WHERE ss.song_id = s.id)`,
    )
    const ids = doomed.rows.map((row) => row.id)
    await deleteSongRows(client, ids)
    const cleared = await client.query(
      `DELETE FROM media_files mf
       WHERE mf.missing = true
         AND EXISTS (SELECT 1 FROM song_sources ss WHERE ss.song_id = mf.song_id)`,
    )
    const jobs = await client.query(
      `DELETE FROM jobs
       WHERE status IN ('success', 'failed')
         AND id < COALESCE((
           SELECT id FROM jobs
           WHERE status IN ('success', 'failed')
           ORDER BY id DESC
           OFFSET $1
           LIMIT 1
         ), 0)`,
      [KEEP_FINISHED_JOBS - 1],
    )
    const scrobbles = await client.query(
      `DELETE FROM scrobbles
       WHERE id < COALESCE((
         SELECT id FROM scrobbles
         ORDER BY id DESC
         OFFSET $1
         LIMIT 1
       ), 0)`,
      [KEEP_SCROBBLES - 1],
    )
    await client.query('COMMIT')
    return {
      removedSongs: ids.length,
      clearedFiles: cleared.rowCount ?? 0,
      trimmedJobs: jobs.rowCount ?? 0,
      trimmedScrobbles: scrobbles.rowCount ?? 0,
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
