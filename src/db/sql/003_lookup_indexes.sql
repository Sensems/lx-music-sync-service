-- 专辑列表、歌手关系和歌单成员都按这些外键查找。
-- Postgres 不会给外键自动建索引，曲库变大后相关子查询会扫全表。
CREATE INDEX IF NOT EXISTS songs_album_id_idx ON songs (album_id);
CREATE INDEX IF NOT EXISTS song_artists_artist_id_idx ON song_artists (artist_id);
CREATE INDEX IF NOT EXISTS playlist_items_song_id_idx ON playlist_items (song_id);
