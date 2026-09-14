import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema.js'

export type { Database }

function migrateDownloads(db: Database.Database): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(downloads)`).all() as { name: string }[]).map(c => c.name),
  )
  const add = (name: string, ddl: string) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE downloads ADD COLUMN ${ddl}`)
  }
  add('name', `name TEXT NOT NULL DEFAULT ''`)
  add('singer', `singer TEXT NOT NULL DEFAULT ''`)
  add('source', `source TEXT NOT NULL DEFAULT ''`)
  add('pic_url', `pic_url TEXT NOT NULL DEFAULT ''`)
  add('raw', `raw TEXT NOT NULL DEFAULT '{}'`)
}

function migratePlaylists(db: Database.Database): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(playlists)`).all() as { name: string }[]).map(c => c.name),
  )
  if (!cols.has('cover_url')) {
    db.exec(`ALTER TABLE playlists ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''`)
  }
}

/** Pull cover= from share URLs (common on Kugou mobile links). */
export function coverFromPlaylistUrl(url: string): string {
  try {
    const u = new URL(url)
    const cover = u.searchParams.get('cover')
    if (cover && /^https?:\/\//i.test(cover)) return cover
  } catch {
    /* ignore */
  }
  return ''
}

function backfillPlaylistCovers(db: Database.Database): void {
  const rows = db
    .prepare(`SELECT id, url, cover_url FROM playlists WHERE cover_url = '' OR cover_url IS NULL`)
    .all() as { id: number; url: string; cover_url: string }[]
  const update = db.prepare(`UPDATE playlists SET cover_url = ? WHERE id = ?`)
  for (const row of rows) {
    const cover = coverFromPlaylistUrl(row.url)
    if (cover) update.run(cover, row.id)
  }
}

/** Fill download meta from playlist_tracks for rows created before meta columns existed. */
function backfillDownloadMeta(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT song_key, name, singer, source, pic_url, raw
       FROM downloads
       WHERE pic_url = '' OR name = '' OR source = '' OR raw = '' OR raw = '{}'`,
    )
    .all() as {
    song_key: string
    name: string
    singer: string
    source: string
    pic_url: string
    raw: string
  }[]
  if (!rows.length) return

  const findTrack = db.prepare(
    `SELECT name, singer, raw FROM playlist_tracks
     WHERE song_key = ? AND raw IS NOT NULL AND raw != '' AND raw != '{}'
     LIMIT 1`,
  )
  const update = db.prepare(
    `UPDATE downloads
     SET name = @name, singer = @singer, source = @source, pic_url = @pic_url, raw = @raw
     WHERE song_key = @song_key`,
  )

  const tx = db.transaction(() => {
    for (const row of rows) {
      const track = findTrack.get(row.song_key) as
        | { name: string; singer: string; raw: string }
        | undefined
      if (!track) continue

      let music: {
        name?: string
        singer?: string
        source?: string
        meta?: { picUrl?: unknown }
      } = {}
      try {
        music = JSON.parse(track.raw) as typeof music
      } catch {
        continue
      }

      const picUrl = String(music.meta?.picUrl || '')
      const source =
        row.source ||
        String(music.source || '') ||
        (/^(wy|tx|kg|kw|mg)_/.exec(row.song_key)?.[1] ?? '')

      update.run({
        song_key: row.song_key,
        name: row.name || music.name || track.name || '',
        singer: row.singer || music.singer || track.singer || '',
        source,
        pic_url: row.pic_url || picUrl,
        raw: row.raw && row.raw !== '{}' ? row.raw : track.raw,
      })
    }
  })
  tx()
}

export function openDb(filePath: string): Database.Database {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  migrateDownloads(db)
  migratePlaylists(db)
  backfillDownloadMeta(db)
  backfillPlaylistCovers(db)
  return db
}
