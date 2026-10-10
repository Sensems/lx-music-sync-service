CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artists (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS albums (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  album_artist_id bigint NOT NULL REFERENCES artists (id),
  cover_url text NOT NULL DEFAULT '',
  cover_path text NOT NULL DEFAULT '',
  UNIQUE (album_artist_id, title)
);

CREATE TABLE IF NOT EXISTS album_sources (
  platform text NOT NULL,
  platform_album_id text NOT NULL,
  album_id bigint NOT NULL REFERENCES albums (id),
  PRIMARY KEY (platform, platform_album_id)
);

CREATE TABLE IF NOT EXISTS songs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  album_id bigint NOT NULL REFERENCES albums (id),
  duration_ms integer,
  track_no integer,
  disc_no integer,
  lyric text NOT NULL DEFAULT '',
  tlyric text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS song_artists (
  song_id bigint NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  artist_id bigint NOT NULL REFERENCES artists (id),
  position integer NOT NULL,
  PRIMARY KEY (song_id, position)
);

CREATE TABLE IF NOT EXISTS song_sources (
  platform text NOT NULL,
  platform_song_id text NOT NULL,
  song_id bigint NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (platform, platform_song_id)
);

CREATE INDEX IF NOT EXISTS song_sources_song_id_idx ON song_sources (song_id);

CREATE TABLE IF NOT EXISTS media_files (
  song_id bigint PRIMARY KEY REFERENCES songs (id) ON DELETE CASCADE,
  path text NOT NULL,
  size bigint NOT NULL,
  mtime_ms bigint NOT NULL,
  quality text NOT NULL DEFAULT '',
  missing boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS library_roots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS playlists (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('subscription', 'user')),
  name text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id bigint NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  position integer NOT NULL,
  song_id bigint NOT NULL REFERENCES songs (id),
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS stars (
  target_type text NOT NULL CHECK (target_type IN ('song', 'album', 'artist')),
  target_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS scrobbles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id bigint NOT NULL REFERENCES songs (id),
  played_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scrobbles_song_idx ON scrobbles (song_id);
CREATE INDEX IF NOT EXISTS scrobbles_played_idx ON scrobbles (played_at);

CREATE TABLE IF NOT EXISTS jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
