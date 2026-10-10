import type { PoolClient } from 'pg'
import { collapseSpace } from './normalize.js'
import type { IngestTrack } from './types.js'

export type UpsertHit = 'strong' | 'medium' | 'created'

/**
 * 零行或多行都返回 null。多行时标题和专辑对得上，但分不清该挂哪一首，
 * 调用方应走新建，而不是随便取第一行。
 */
const MEDIUM_MATCH_SQL = `
SELECT s.id::text AS id
FROM songs s
JOIN albums a ON a.id = s.album_id
JOIN artists ar ON ar.id = a.album_artist_id
WHERE s.title = $1
  AND a.title = $2
  AND ar.name = $3
  AND s.duration_ms IS NOT NULL
  AND abs(s.duration_ms - $4) <= 2000
`

export async function findMediumMatch(
  client: PoolClient,
  input: { title: string; albumTitle: string; albumArtist: string; durationMs: number },
): Promise<string | null> {
  const found = await client.query<{ id: string }>(MEDIUM_MATCH_SQL, [
    input.title,
    input.albumTitle,
    input.albumArtist,
    input.durationMs,
  ])
  if (found.rows.length !== 1) return null
  return found.rows[0]?.id ?? null
}

/** song_sources.raw 是 NOT NULL。缺原文时写成空对象，避免变成 SQL NULL。 */
function rawJson(raw: unknown): string {
  if (raw === undefined || raw === null) return '{}'
  return JSON.stringify(raw)
}

/**
 * 空白名字丢掉。全空才换成「未知歌手」：空串会占住 artists.name 的唯一键，
 * 专辑歌手也会是空的，中等匹配对不上后来补上的真名。
 * 返回的 hadName 表示调用方确实给了名字；换成默认名时不做中等匹配。
 */
function singerList(singers: string[]): { names: string[]; hadName: boolean } {
  const names = singers.map((name) => collapseSpace(name)).filter((name) => name.length > 0)
  if (names.length === 0) return { names: ['未知歌手'], hadName: false }
  return { names, hadName: true }
}

/** 空专辑名换成「未知专辑」，但缺专辑名时不做中等匹配，避免把无关的歌并到同一张占位专辑。 */
function albumName(albumTitle: string): { title: string; hadTitle: boolean } {
  const title = collapseSpace(albumTitle)
  if (title.length === 0) return { title: '未知专辑', hadTitle: false }
  return { title, hadTitle: true }
}

async function findStrong(client: PoolClient, track: IngestTrack): Promise<string | null> {
  const found = await client.query<{ song_id: string }>(
    `SELECT song_id::text AS song_id
     FROM song_sources
     WHERE platform = $1 AND platform_song_id = $2`,
    [track.platform, track.platformSongId],
  )
  return found.rows[0]?.song_id ?? null
}

async function writeRaw(client: PoolClient, track: IngestTrack): Promise<void> {
  await client.query(
    `UPDATE song_sources
     SET raw = $3::jsonb
     WHERE platform = $1 AND platform_song_id = $2`,
    [track.platform, track.platformSongId, rawJson(track.raw)],
  )
}

/** 只补原来的空时长。已有时长来自另一条来源，后来的刮削不能把它改掉。 */
async function fillDuration(client: PoolClient, songId: string, durationMs: number | null): Promise<void> {
  if (durationMs == null) return
  await client.query(
    `UPDATE songs
     SET duration_ms = $2
     WHERE id = $1::bigint AND duration_ms IS NULL`,
    [songId, durationMs],
  )
}

/** 封面只填当前还是空串的专辑。已有地址保持第一次写入的那份。 */
async function fillCover(client: PoolClient, albumId: string, coverUrl: string | null): Promise<void> {
  if (coverUrl == null || coverUrl.length === 0) return
  await client.query(
    `UPDATE albums
     SET cover_url = $2
     WHERE id = $1::bigint AND cover_url = ''`,
    [albumId, coverUrl],
  )
}

async function fillCoverForSong(client: PoolClient, songId: string, coverUrl: string | null): Promise<void> {
  if (coverUrl == null || coverUrl.length === 0) return
  await client.query(
    `UPDATE albums AS a
     SET cover_url = $2
     FROM songs AS s
     WHERE s.id = $1::bigint
       AND a.id = s.album_id
       AND a.cover_url = ''`,
    [songId, coverUrl],
  )
}

/**
 * 平台身份已存在时什么都不改。强匹配会先更新 raw；
 * 这里用 DO NOTHING，避免中等合并把另一首歌的平台 id 改挂过来。
 */
async function attachSource(client: PoolClient, track: IngestTrack, songId: string): Promise<void> {
  await client.query(
    `INSERT INTO song_sources (platform, platform_song_id, song_id, raw)
     VALUES ($1, $2, $3::bigint, $4::jsonb)
     ON CONFLICT DO NOTHING`,
    [track.platform, track.platformSongId, songId, rawJson(track.raw)],
  )
}

async function ensureArtist(client: PoolClient, name: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(name)
  if (cached) return cached
  await client.query(
    `INSERT INTO artists (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
    [name],
  )
  const found = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM artists WHERE name = $1`,
    [name],
  )
  const id = found.rows[0]?.id
  if (!id) throw new Error('artist missing after insert')
  cache.set(name, id)
  return id
}

async function ensureAlbum(client: PoolClient, albumArtistId: string, title: string): Promise<string> {
  await client.query(
    `INSERT INTO albums (title, album_artist_id)
     VALUES ($1, $2::bigint)
     ON CONFLICT (album_artist_id, title) DO NOTHING`,
    [title, albumArtistId],
  )
  const found = await client.query<{ id: string }>(
    `SELECT id::text AS id
      FROM albums
      WHERE album_artist_id = $1::bigint AND title = $2`,
    [albumArtistId, title],
  )
  const id = found.rows[0]?.id
  if (!id) throw new Error('album missing after insert')
  return id
}

/**
 * 调用方负责 BEGIN / COMMIT。这里不开事务，歌单可以在同一事务里逐首调用，失败时整批回滚。
 * 顺序：强匹配（平台 + 平台歌曲 id）→ 中等匹配（标题、专辑、专辑歌手、时长差 2 秒内且恰好一行）→ 新建。
 */
export async function upsertTrack(
  client: PoolClient,
  track: IngestTrack,
): Promise<{ songId: string; hit: UpsertHit }> {
  const singers = singerList(track.singers)
  const album = albumName(track.albumTitle)
  const albumArtist = singers.names[0]
  if (!albumArtist) throw new Error('album artist missing')

  const strongId = await findStrong(client, track)
  if (strongId) {
    await writeRaw(client, track)
    await fillDuration(client, strongId, track.durationMs)
    await fillCoverForSong(client, strongId, track.coverUrl)
    return { songId: strongId, hit: 'strong' }
  }

  if (track.durationMs != null && album.hadTitle && singers.hadName) {
    const mediumId = await findMediumMatch(client, {
      title: track.title,
      albumTitle: album.title,
      albumArtist,
      durationMs: track.durationMs,
    })
    if (mediumId) {
      await attachSource(client, track, mediumId)
      await fillDuration(client, mediumId, track.durationMs)
      await fillCoverForSong(client, mediumId, track.coverUrl)
      return { songId: mediumId, hit: 'medium' }
    }
  }

  const cache = new Map<string, string>()
  const artistIds: string[] = []
  for (const name of singers.names) {
    artistIds.push(await ensureArtist(client, name, cache))
  }
  const albumArtistId = artistIds[0]
  if (!albumArtistId) throw new Error('album artist missing')
  const createdAlbumId = await ensureAlbum(client, albumArtistId, album.title)
  await fillCover(client, createdAlbumId, track.coverUrl)

  // 同一平台专辑 id 已经指向别的专辑时保持原指向，不把这次解析到的专辑写回去。
  if (track.albumPlatformId != null && track.albumPlatformId.length > 0) {
    await client.query(
      `INSERT INTO album_sources (platform, platform_album_id, album_id)
       VALUES ($1, $2, $3::bigint)
       ON CONFLICT DO NOTHING`,
      [track.platform, track.albumPlatformId, createdAlbumId],
    )
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO songs (title, album_id, duration_ms, track_no, disc_no)
     VALUES ($1, $2::bigint, $3, $4, $5)
     RETURNING id::text AS id`,
    [track.title, createdAlbumId, track.durationMs, track.trackNo, track.discNo],
  )
  const songId = inserted.rows[0]?.id
  if (!songId) throw new Error('song missing after insert')

  // position 从 0 起，和 playlist_items 一样。第一位是专辑歌手。
  for (let position = 0; position < artistIds.length; position++) {
    await client.query(
      `INSERT INTO song_artists (song_id, artist_id, position)
       VALUES ($1::bigint, $2::bigint, $3)`,
      [songId, artistIds[position], position],
    )
  }
  await attachSource(client, track, songId)
  return { songId, hit: 'created' }
}
