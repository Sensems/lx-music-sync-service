import type { Pool, PoolClient } from 'pg'
import { toNewMusicInfo } from '../lib/toNewMusicInfo.js'
import type { GetListDetail } from '../services/playlists.js'
import { collapseSpace, ingestTrackFromMusic } from './normalize.js'
import type { IngestTrack } from './types.js'
import { upsertTrack } from './upsert.js'

const PLATFORMS: readonly IngestTrack['platform'][] = ['kw', 'kg', 'tx', 'wy', 'mg']

/**
 * 专辑封面只收 http(s)。相对路径和「null」这类占位不写进 albums，
 * 规则与曲目封面一致。
 */
function httpCover(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^https?:\/\//i.test(text)) return null
  return text
}

function platformOf(value: string): IngestTrack['platform'] {
  const found = PLATFORMS.find((item) => item === value)
  if (!found) throw new Error(`unsupported platform: ${value}`)
  return found
}

/**
 * 与 playlists.ts 的 fetchAllTracks 同一套分页。
 * 不调用 refreshPlaylistSnapshot：那条路径会写 SQLite，
 * 而这里必须等整份刮完才开 Postgres 事务。
 */
async function scrapePlaylist(
  platform: IngestTrack['platform'],
  sourceUrl: string,
  getListDetail: GetListDetail,
): Promise<{ tracks: unknown[]; name: string; img: unknown }> {
  const first = await getListDetail(platform, sourceUrl, 1)
  const all: unknown[] = [...(first.list ?? [])]
  const limit = first.limit || 30
  const total = first.total ?? all.length
  const pages = Math.max(1, Math.ceil(total / limit))
  for (let page = 2; page <= pages; page++) {
    const next = await getListDetail(platform, sourceUrl, page)
    all.push(...(next.list ?? []))
  }
  const info = first.info ?? { name: '' }
  return { tracks: all, name: info.name ?? '', img: info.img }
}

/**
 * 歌单表没有封面列。info.img 没有时用第一条曲目的封面，
 * 只补到自身还没有封面的曲目上；专辑已有封面时 upsertTrack 不会覆盖。
 */
function withSharedCover(tracks: IngestTrack[], infoImg: unknown): IngestTrack[] {
  const shared = httpCover(infoImg) ?? tracks[0]?.coverUrl ?? null
  if (shared == null) return tracks
  return tracks.map((track) => (track.coverUrl ? track : { ...track, coverUrl: shared }))
}

async function loadSubscription(
  pool: Pool,
  playlistId: string,
): Promise<{ platform: IngestTrack['platform']; sourceUrl: string }> {
  const found = await pool.query<{ platform: string; source_url: string }>(
    `SELECT platform, source_url
     FROM playlists
     WHERE id = $1::bigint AND kind = 'subscription'`,
    [playlistId],
  )
  const row = found.rows[0]
  if (!row) throw new Error(`subscription not found: ${playlistId}`)
  return { platform: platformOf(row.platform), sourceUrl: row.source_url }
}

/**
 * 刮削在事务外已经结束。这里任何 SQL 失败都要回滚，
 * 否则半截 upsert 会留下新歌，旧的 playlist_items 也会被删掉。
 */
async function inTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    try {
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackErr) {
        // 回滚失败时这条连接不能还回池里，否则下一笔会接着脏事务。
        broken = rollbackErr instanceof Error ? rollbackErr : new Error('rollback failed')
      }
      throw err
    }
  } finally {
    client.release(broken)
  }
}

export async function createSubscription(
  pool: Pool,
  input: { platform: IngestTrack['platform']; sourceUrl: string },
): Promise<{ playlistId: string }> {
  // 名字先空着。在线标题要等整份刮削成功才写，失败时不能留下半成品标题。
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO playlists (kind, platform, source_url)
     VALUES ('subscription', $1, $2)
     RETURNING id::text AS id`,
    [input.platform, input.sourceUrl],
  )
  const playlistId = inserted.rows[0]?.id
  if (!playlistId) throw new Error('playlist missing after insert')
  return { playlistId }
}

export async function refreshSubscription(
  pool: Pool,
  playlistId: string,
  getListDetail: GetListDetail,
): Promise<{ playlistId: string; count: number }> {
  const subscription = await loadSubscription(pool, playlistId)
  // 某一页或某一首转换失败时还没 BEGIN，旧成员保持原样。
  const scraped = await scrapePlaylist(subscription.platform, subscription.sourceUrl, getListDetail)
  const ingested = withSharedCover(
    scraped.tracks.map((track) => ingestTrackFromMusic(toNewMusicInfo(track))),
    scraped.img,
  )
  const onlineName = collapseSpace(scraped.name)

  await inTransaction(pool, async (client) => {
    // 刮削期间歌单可能被删掉。先确认还是订阅，再写入，避免把成员写进用户歌单。
    const still = await client.query(
      `SELECT 1 FROM playlists WHERE id = $1::bigint AND kind = 'subscription'`,
      [playlistId],
    )
    if ((still.rowCount ?? 0) === 0) throw new Error(`subscription not found: ${playlistId}`)

    const songIds: string[] = []
    for (const track of ingested) {
      const saved = await upsertTrack(client, track)
      songIds.push(saved.songId)
    }
    // 全部 upsert 成功后才换成员。少掉的歌只离开这份歌单，歌曲和文件都留着。
    await client.query(`DELETE FROM playlist_items WHERE playlist_id = $1::bigint`, [playlistId])
    for (let position = 0; position < songIds.length; position++) {
      await client.query(
        `INSERT INTO playlist_items (playlist_id, position, song_id)
         VALUES ($1::bigint, $2, $3::bigint)`,
        [playlistId, position, songIds[position]],
      )
    }
    if (onlineName.length > 0) {
      await client.query(
        `UPDATE playlists
         SET name = $2
         WHERE id = $1::bigint AND name = ''`,
        [playlistId, onlineName],
      )
    }
  })

  return { playlistId, count: ingested.length }
}
