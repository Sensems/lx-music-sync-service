export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  name_custom INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  save_dir TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL,
  song_key TEXT NOT NULL,
  name TEXT NOT NULL,
  singer TEXT NOT NULL,
  album TEXT NOT NULL,
  qualitys TEXT NOT NULL,
  raw TEXT NOT NULL,
  PRIMARY KEY (playlist_id, song_key),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS downloads (
  song_key TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  quality TEXT NOT NULL,
  playlist_id INTEGER,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('playlist', 'search')),
  completed_at INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  singer TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  pic_url TEXT NOT NULL DEFAULT '',
  raw TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('playlist', 'all', 'search')),
  playlist_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  scanned INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  downloaded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
