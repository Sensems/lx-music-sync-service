import type Database from 'better-sqlite3'
import type { OnlineSource, Quality } from '../types.js'

export type PlaylistRow = {
  id: number
  source: OnlineSource
  url: string
  name: string
  name_custom: number
  enabled: number
  save_dir: string
  cover_url: string
  created_at: number
  updated_at: number
}

export type TrackRow = {
  playlist_id: number
  song_key: string
  name: string
  singer: string
  album: string
  qualitys: string
  raw: string
}

export type DownloadRow = {
  song_key: string
  file_path: string
  quality: Quality
  playlist_id: number | null
  source_kind: 'playlist' | 'search'
  completed_at: number
  name?: string
  singer?: string
  source?: string
  pic_url?: string
  raw?: string
}

export type JobStatus = 'running' | 'success' | 'failed' | 'skipped'

export type JobRow = {
  id: number
  kind: 'playlist' | 'all' | 'search'
  playlist_id: number | null
  status: JobStatus
  started_at: number
  finished_at: number | null
  scanned: number
  skipped: number
  downloaded: number
  failed: number
  error_summary: string | null
}

export type JobInsert = Omit<JobRow, 'id'>

export type JobUpdate = Partial<Omit<JobRow, 'id'>> & { id: number }

const DEFAULT_SETTINGS: Record<string, string> = {
  savePath: './data/music',
  quality: '320k',
  scheduleOn: '0',
  schedule: 'every-6h',
  scheduleTime: '03:00',
  cron: '0 */6 * * *',
  concurrency: '3',
  fileName: 'name-singer',
  proxyOn: '0',
  proxyHost: '',
  proxyPort: '',
}

function rowToPlaylist(row: Record<string, unknown>): PlaylistRow {
  return {
    id: Number(row.id),
    source: row.source as OnlineSource,
    url: String(row.url ?? ''),
    name: String(row.name ?? ''),
    name_custom: Number(row.name_custom ?? 0),
    enabled: Number(row.enabled ?? 1),
    save_dir: String(row.save_dir ?? ''),
    cover_url: String(row.cover_url ?? ''),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  }
}

function rowToTrack(row: Record<string, unknown>): TrackRow {
  return row as unknown as TrackRow
}

function rowToDownload(row: Record<string, unknown>): DownloadRow {
  const r = row as Record<string, unknown>
  return {
    song_key: String(r.song_key),
    file_path: String(r.file_path),
    quality: r.quality as Quality,
    playlist_id: r.playlist_id == null ? null : Number(r.playlist_id),
    source_kind: r.source_kind as DownloadRow['source_kind'],
    completed_at: Number(r.completed_at),
    name: String(r.name ?? ''),
    singer: String(r.singer ?? ''),
    source: String(r.source ?? ''),
    pic_url: String(r.pic_url ?? ''),
    raw: String(r.raw ?? '{}'),
  }
}

function rowToJob(row: Record<string, unknown>): JobRow {
  const r = row as Record<string, unknown>
  return {
    ...r,
    playlist_id: r.playlist_id == null ? null : Number(r.playlist_id),
    finished_at: r.finished_at == null ? null : Number(r.finished_at),
    error_summary: r.error_summary == null ? null : String(r.error_summary),
  } as JobRow
}

export function createRepos(db: Database.Database) {
  const playlists = {
    insert(input: { source: OnlineSource; url: string }): PlaylistRow {
      const now = Date.now()
      const result = db
        .prepare(
          `INSERT INTO playlists (source, url, name, name_custom, enabled, save_dir, created_at, updated_at)
           VALUES (@source, @url, '', 0, 1, '', @created_at, @updated_at)`,
        )
        .run({ source: input.source, url: input.url, created_at: now, updated_at: now })
      const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(result.lastInsertRowid)
      return rowToPlaylist(row as Record<string, unknown>)
    },

    get(id: number): PlaylistRow | undefined {
      const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? rowToPlaylist(row) : undefined
    },

    list(): PlaylistRow[] {
      const rows = db.prepare('SELECT * FROM playlists ORDER BY id').all() as Record<string, unknown>[]
      return rows.map(rowToPlaylist)
    },

    patch(id: number, partial: { name?: string; enabled?: number }): PlaylistRow {
      const existing = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!existing) {
        throw new Error(`playlist not found: ${id}`)
      }
      const now = Date.now()
      let name = existing.name as string
      let name_custom = existing.name_custom as number
      let enabled = existing.enabled as number
      if (partial.name !== undefined) {
        name = partial.name
        name_custom = 1
      }
      if (partial.enabled !== undefined) {
        enabled = partial.enabled
      }
      db.prepare(
        `UPDATE playlists SET name = @name, name_custom = @name_custom, enabled = @enabled, updated_at = @updated_at WHERE id = @id`,
      ).run({ id, name, name_custom, enabled, updated_at: now })
      const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id)
      return rowToPlaylist(row as Record<string, unknown>)
    },

    /** Update name/save_dir/cover after snapshot refresh without flipping name_custom. */
    updateAfterRefresh(
      id: number,
      partial: { name?: string; save_dir?: string; cover_url?: string },
    ): PlaylistRow {
      const existing = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!existing) {
        throw new Error(`playlist not found: ${id}`)
      }
      const now = Date.now()
      const name = partial.name !== undefined ? partial.name : (existing.name as string)
      const save_dir = partial.save_dir !== undefined ? partial.save_dir : (existing.save_dir as string)
      const cover_url =
        partial.cover_url !== undefined ? partial.cover_url : String(existing.cover_url ?? '')
      db.prepare(
        `UPDATE playlists SET name = @name, save_dir = @save_dir, cover_url = @cover_url, updated_at = @updated_at WHERE id = @id`,
      ).run({ id, name, save_dir, cover_url, updated_at: now })
      const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id)
      return rowToPlaylist(row as Record<string, unknown>)
    },

    remove(id: number): void {
      db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    },
  }

  const tracks = {
    replaceAll(playlistId: number, rows: TrackRow[]): void {
      const del = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?')
      const ins = db.prepare(
        `INSERT INTO playlist_tracks (playlist_id, song_key, name, singer, album, qualitys, raw)
         VALUES (@playlist_id, @song_key, @name, @singer, @album, @qualitys, @raw)`,
      )
      const tx = db.transaction(() => {
        del.run(playlistId)
        for (const row of rows) {
          ins.run(row)
        }
      })
      tx()
    },

    list(playlistId: number): TrackRow[] {
      const rows = db
        .prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY rowid')
        .all(playlistId) as Record<string, unknown>[]
      return rows.map(rowToTrack)
    },

    findBySongKey(songKey: string): TrackRow | undefined {
      const row = db
        .prepare('SELECT * FROM playlist_tracks WHERE song_key = ? ORDER BY rowid LIMIT 1')
        .get(songKey) as Record<string, unknown> | undefined
      return row ? rowToTrack(row) : undefined
    },
  }

  const downloads = {
    get(songKey: string): DownloadRow | undefined {
      const row = db.prepare('SELECT * FROM downloads WHERE song_key = ?').get(songKey) as
        | Record<string, unknown>
        | undefined
      return row ? rowToDownload(row) : undefined
    },

    list(): DownloadRow[] {
      const rows = db
        .prepare('SELECT * FROM downloads ORDER BY completed_at DESC')
        .all() as Record<string, unknown>[]
      return rows.map(rowToDownload)
    },

    upsert(row: DownloadRow): void {
      db.prepare(
        `INSERT INTO downloads (song_key, file_path, quality, playlist_id, source_kind, completed_at, name, singer, source, pic_url, raw)
         VALUES (@song_key, @file_path, @quality, @playlist_id, @source_kind, @completed_at, @name, @singer, @source, @pic_url, @raw)
         ON CONFLICT(song_key) DO UPDATE SET
           file_path = excluded.file_path,
           quality = excluded.quality,
           playlist_id = excluded.playlist_id,
           source_kind = excluded.source_kind,
           completed_at = excluded.completed_at,
           name = excluded.name,
           singer = excluded.singer,
           source = excluded.source,
           pic_url = excluded.pic_url,
           raw = excluded.raw`,
      ).run({
        ...row,
        name: row.name ?? '',
        singer: row.singer ?? '',
        source: row.source ?? '',
        pic_url: row.pic_url ?? '',
        raw: row.raw ?? '{}',
      })
    },
  }

  const jobs = {
    insert(row: JobInsert): JobRow {
      const result = db
        .prepare(
          `INSERT INTO sync_jobs (kind, playlist_id, status, started_at, finished_at, scanned, skipped, downloaded, failed, error_summary)
           VALUES (@kind, @playlist_id, @status, @started_at, @finished_at, @scanned, @skipped, @downloaded, @failed, @error_summary)`,
        )
        .run({
          kind: row.kind,
          playlist_id: row.playlist_id,
          status: row.status,
          started_at: row.started_at,
          finished_at: row.finished_at,
          scanned: row.scanned,
          skipped: row.skipped,
          downloaded: row.downloaded,
          failed: row.failed,
          error_summary: row.error_summary,
        })
      const inserted = db.prepare('SELECT * FROM sync_jobs WHERE id = ?').get(result.lastInsertRowid)
      return rowToJob(inserted as Record<string, unknown>)
    },

    update(partial: JobUpdate): JobRow {
      const existing = db.prepare('SELECT * FROM sync_jobs WHERE id = ?').get(partial.id) as
        | Record<string, unknown>
        | undefined
      if (!existing) {
        throw new Error(`job not found: ${partial.id}`)
      }
      const merged = { ...existing, ...partial }
      db.prepare(
        `UPDATE sync_jobs SET
           kind = @kind,
           playlist_id = @playlist_id,
           status = @status,
           started_at = @started_at,
           finished_at = @finished_at,
           scanned = @scanned,
           skipped = @skipped,
           downloaded = @downloaded,
           failed = @failed,
           error_summary = @error_summary
         WHERE id = @id`,
      ).run(merged)
      const row = db.prepare('SELECT * FROM sync_jobs WHERE id = ?').get(partial.id)
      return rowToJob(row as Record<string, unknown>)
    },

    list(): JobRow[] {
      const rows = db
        .prepare('SELECT * FROM sync_jobs ORDER BY id DESC')
        .all() as Record<string, unknown>[]
      return rows.map(rowToJob)
    },
  }

  const settings = {
    getAll(): Record<string, string> {
      const out = { ...DEFAULT_SETTINGS }
      const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
      for (const { key, value } of rows) {
        out[key] = value
      }
      return out
    },

    setMany(partial: Record<string, string>): void {
      const upsert = db.prepare(
        `INSERT INTO settings (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      const tx = db.transaction((entries: [string, string][]) => {
        for (const [key, value] of entries) {
          upsert.run({ key, value })
        }
      })
      tx(Object.entries(partial))
    },
  }

  return { playlists, tracks, downloads, jobs, settings }
}
