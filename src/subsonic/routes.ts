import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import { coverFile, lyricText } from '../library/artwork.js'
import { createOpenSong } from '../library/openSong.js'
import { getLyricForMusic } from '../services/lyrics.js'
import { getPicForMusic } from '../services/pic.js'
import type { MusicInfo, OnlineSource, Quality } from '../types.js'
import { requireSubsonic } from './auth.js'
import { sendErr, sendOk } from './respond.js'

/**
 * 歌手、专辑、歌曲三张表的 bigint 会重复。
 * 目录 id 必须带前缀，歌曲 id 保持十进制，客户端才不会把专辑当成歌曲。
 */
const MUSIC_FOLDER_ID = '1'
const MUSIC_FOLDER_NAME = '听柜'
const ARTIST_PREFIX = 'ar-'
const ALBUM_PREFIX = 'al-'
const BIGINT_MAX = 9223372036854775807n
const DEFAULT_USER = 'tinggui'
const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'] as const satisfies readonly OnlineSource[]
const QUALITIES = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const satisfies readonly Quality[]

type Format = 'json' | 'xml'

export type SubsonicDeps = {
  dataDir: string
  pool: Pool
  getMusicUrl: (source: string, musicInfo: MusicInfo, quality: Quality) => Promise<{ type: Quality; url: string }>
  getStatus: () => { sources: { [platform: string]: { qualitys?: readonly string[] } | undefined } }
}

type OpenSong = {
  open(songId: string, rangeHeader: string | undefined): Promise<Response>
}

type PlaybackSettings = {
  order: OnlineSource[]
  quality: Quality
}

type ArtistRow = {
  id: string
  name: string
  album_count: number | string
}

type AlbumRow = {
  id: string
  title: string
  artist: string
  artist_id: string
  song_count: number | string
  duration_ms: number | string | null
}

type SongRow = {
  id: string
  title: string
  duration_ms: number | null
  album_id: string
  album: string
  artist: string
}

type View = (c: Context, format: Format) => Promise<Response> | Response

const ALBUM_FIELDS = `
al.id::text AS id,
al.title,
ar.name AS artist,
ar.id::text AS artist_id,
(SELECT COUNT(*)::int FROM songs s WHERE s.album_id = al.id) AS song_count,
(SELECT COALESCE(SUM(s.duration_ms), 0)::bigint FROM songs s WHERE s.album_id = al.id) AS duration_ms
`

const SONG_FIELDS = `
s.id::text AS id,
s.title,
s.duration_ms,
s.album_id::text AS album_id,
al.title AS album,
COALESCE(
  (
    SELECT string_agg(ar.name, '、' ORDER BY sa.position)
    FROM song_artists sa
    JOIN artists ar ON ar.id = sa.artist_id
    WHERE sa.song_id = s.id
  ),
  aa.name,
  ''
) AS artist
`

const SONG_FROM = `
FROM songs s
JOIN albums al ON al.id = s.album_id
JOIN artists aa ON aa.id = al.album_artist_id
`

const SONG_ORDER = 's.disc_no ASC NULLS LAST, s.track_no ASC NULLS LAST, s.id ASC'

function artistKey(id: string): string {
  return `${ARTIST_PREFIX}${id}`
}

function albumKey(id: string): string {
  return `${ALBUM_PREFIX}${id}`
}

/** 非法 id 不送进 ::bigint，避免驱动把转换失败抛成 500。 */
function isLibraryId(id: string): boolean {
  if (!/^\d+$/.test(id)) return false
  try {
    const value = BigInt(id)
    return value >= 0n && value <= BIGINT_MAX
  } catch {
    return false
  }
}

function parsePrefixed(raw: string, prefix: string): string | null {
  if (!raw.startsWith(prefix)) return null
  const id = raw.slice(prefix.length)
  return isLibraryId(id) ? id : null
}

/**
 * getAlbum / getCoverArt 收到的 id 可能是目录上的 al-，也可能是裸的十进制。
 * 两种都指向同一张专辑，封面字段和目录 id 才能对上。
 */
function parseAlbumId(raw: string | undefined): string | null {
  if (!raw) return null
  const prefixed = parsePrefixed(raw, ALBUM_PREFIX)
  if (prefixed) return prefixed
  return isLibraryId(raw) ? raw : null
}

function parseArtistId(raw: string | undefined): string | null {
  if (!raw) return null
  const prefixed = parsePrefixed(raw, ARTIST_PREFIX)
  if (prefixed) return prefixed
  return isLibraryId(raw) ? raw : null
}

function parseSongId(raw: string | undefined): string | null {
  if (!raw || !isLibraryId(raw)) return null
  return raw
}

function parseDirectoryId(
  raw: string | undefined,
): { kind: 'root' } | { kind: 'artist'; id: string } | { kind: 'album'; id: string } | null {
  if (raw === MUSIC_FOLDER_ID) return { kind: 'root' }
  if (!raw) return null
  const artistId = parsePrefixed(raw, ARTIST_PREFIX)
  if (artistId) return { kind: 'artist', id: artistId }
  const albumId = parsePrefixed(raw, ALBUM_PREFIX)
  if (albumId) return { kind: 'album', id: albumId }
  return null
}

/**
 * 只有一个音乐文件夹。客户端若点了别的编号，不能把整库冒充成那个文件夹。
 */
function folderMatches(raw: string | undefined): boolean {
  if (raw == null || raw.trim() === '') return true
  return raw.trim() === MUSIC_FOLDER_ID
}

function bounded(raw: string | undefined, fallback: number, max: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(0, Math.trunc(value)))
}

/** 时长空或不是正数时给 0。客户端把缺字段当成未知，会去猜长度。 */
function durationSeconds(ms: number | string | null | undefined): number {
  if (ms == null) return 0
  const value = typeof ms === 'number' ? ms : Number(ms)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value / 1000)
}

function countOf(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function isoTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

/**
 * ASCII 字母收成大写，同一位歌手不会因为大小写拆成两格。
 * 其他首字符保持原样，中文不会被塞进 #。没有首字符才进 #。
 */
function indexName(name: string): string {
  const first = Array.from(name.trim())[0]
  if (!first) return '#'
  const code = first.charCodeAt(0)
  if (code >= 65 && code <= 90) return first
  if (code >= 97 && code <= 122) return first.toUpperCase()
  return first
}

function compareIndex(left: string, right: string): number {
  if (left === right) return 0
  if (left === '#') return 1
  if (right === '#') return -1
  return left.localeCompare(right, 'zh')
}

function groupArtists(rows: ArtistRow[]): Array<{ name: string; artists: ArtistRow[] }> {
  const groups = new Map<string, ArtistRow[]>()
  for (const row of rows) {
    const key = indexName(row.name)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id))
  }
  return [...groups.entries()]
    .sort((a, b) => compareIndex(a[0], b[0]))
    .map(([name, artists]) => ({ name, artists }))
}

function songJson(row: SongRow, starred?: string): Record<string, unknown> {
  // parent 和 coverArt 用专辑的对外 id（al-）。裸 bigint 会和歌曲 id 撞车。
  const albumId = albumKey(row.album_id)
  const song: Record<string, unknown> = {
    id: row.id,
    parent: albumId,
    title: row.title,
    album: row.album,
    artist: row.artist,
    duration: durationSeconds(row.duration_ms),
    isDir: false,
    type: 'music',
    coverArt: albumId,
  }
  if (starred) song.starred = starred
  return song
}

function albumJson(row: AlbumRow, starred?: string): Record<string, unknown> {
  const album: Record<string, unknown> = {
    id: albumKey(row.id),
    name: row.title,
    artist: row.artist,
    artistId: artistKey(row.artist_id),
    coverArt: albumKey(row.id),
    songCount: countOf(row.song_count),
    duration: durationSeconds(row.duration_ms),
  }
  if (starred) album.starred = starred
  return album
}

function missing(c: Context, format: Format): Response {
  return sendErr(c, 10, 'Required parameter is missing', format)
}

function notFound(c: Context, format: Format): Response {
  return sendErr(c, 60, 'The requested data was not found', format)
}

async function readSetting(pool: Pool, key: string): Promise<string | null> {
  const result = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key])
  return result.rows[0]?.value ?? null
}

/** 没写用户名时用 tinggui，和鉴权同一条规则，避免 getUser 和 u 对不上。 */
async function readUser(pool: Pool): Promise<string> {
  const value = await readSetting(pool, 'subsonicUser')
  if (value == null || value.trim() === '') return DEFAULT_USER
  return value
}

function parseSourceOrder(raw: string | null): OnlineSource[] {
  const fallback: OnlineSource[] = [...SOURCES]
  if (raw == null || raw.trim() === '') return fallback
  const seen = new Set<OnlineSource>()
  const order: OnlineSource[] = []
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (!(SOURCES as readonly string[]).includes(name) || seen.has(name as OnlineSource)) continue
    seen.add(name as OnlineSource)
    order.push(name as OnlineSource)
  }
  return order.length > 0 ? order : fallback
}

function parseQuality(raw: string | null): Quality {
  const value = raw?.trim() ?? ''
  if ((QUALITIES as readonly string[]).includes(value)) return value as Quality
  return '128k'
}

/**
 * sourceOrder / wantedQuality 在打开歌曲时是同步读的。
 * 必须先把设置写进这块内存，这次播放才用得上刚改的音质和音源顺序。
 */
async function loadPlayback(pool: Pool, playback: PlaybackSettings): Promise<void> {
  const [orderRaw, qualityRaw] = await Promise.all([
    readSetting(pool, 'sourceOrder'),
    readSetting(pool, 'quality'),
  ])
  playback.order = parseSourceOrder(orderRaw)
  playback.quality = parseQuality(qualityRaw)
}

async function listArtists(pool: Pool): Promise<ArtistRow[]> {
  const result = await pool.query<ArtistRow>(
    `SELECT ar.id::text AS id,
            ar.name,
            COUNT(al.id)::int AS album_count
     FROM artists ar
     JOIN albums al ON al.album_artist_id = ar.id
     GROUP BY ar.id, ar.name`,
  )
  return result.rows
}

async function albumsWhere(pool: Pool, where: string, orderBy: string, params: unknown[]): Promise<AlbumRow[]> {
  const result = await pool.query<AlbumRow>(
    `SELECT ${ALBUM_FIELDS}
     FROM albums al
     JOIN artists ar ON ar.id = al.album_artist_id
     ${where}
     ORDER BY ${orderBy}`,
    params,
  )
  return result.rows
}

async function songsWhere(pool: Pool, where: string, orderBy: string, params: unknown[]): Promise<SongRow[]> {
  const result = await pool.query<SongRow>(
    `SELECT ${SONG_FIELDS}
     ${SONG_FROM}
     ${where}
     ORDER BY ${orderBy}`,
    params,
  )
  return result.rows
}

function stampToMs(minText: string, secText: string, frac: string | undefined): number | null {
  const min = Number(minText)
  const sec = Number(secText)
  if (!Number.isFinite(min) || !Number.isFinite(sec) || sec > 59) return null
  let ms = 0
  if (frac) {
    if (frac.length === 1) ms = Number(frac) * 100
    else if (frac.length === 2) ms = Number(frac) * 10
    else ms = Number(frac.slice(0, 3))
  }
  return min * 60_000 + sec * 1000 + ms
}

/**
 * 歌词多半是 LRC。拆成行之后客户端才能滚动。
 * 语种用 xxx：库里没有语种，不把译文猜成某一种语言。
 */
function structuredLyric(artist: string, title: string, text: string): Record<string, unknown> {
  let offset = 0
  const plain: Array<{ value: string }> = []
  const synced: Array<{ start: number; value: string }> = []
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const offsetTag = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(trimmed)
    if (offsetTag) {
      offset = Number(offsetTag[1] ?? 0)
      continue
    }
    if (/^\[[a-zA-Z]+:[^\]]*\]$/.test(trimmed)) continue
    let rest = trimmed
    const stamps: number[] = []
    for (;;) {
      const matched = /^\[(\d+):(\d{1,2})(?:\.(\d{1,3}))?\]/.exec(rest)
      if (!matched) break
      const ms = stampToMs(matched[1] ?? '', matched[2] ?? '', matched[3])
      if (ms == null) break
      stamps.push(ms)
      rest = rest.slice(matched[0].length)
    }
    rest = rest.trim()
    if (!rest) continue
    if (stamps.length > 0) {
      for (const start of stamps) synced.push({ start, value: rest })
    } else {
      plain.push({ value: rest })
    }
  }
  const syncedLyric = synced.length > 0
  const line = syncedLyric
    ? synced.sort((a, b) => a.start - b.start)
    : plain.length > 0
      ? plain
      : [{ value: text.trim() }]
  return {
    displayArtist: artist,
    displayTitle: title,
    lang: 'xxx',
    offset: syncedLyric ? offset : 0,
    synced: syncedLyric,
    line,
  }
}

function imageContentType(header: Buffer): string {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg'
  if (header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return 'image/png'
  }
  if (header.length >= 6) {
    const gif = header.toString('ascii', 0, 6)
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  }
  if (
    header.length >= 12
    && header.toString('ascii', 0, 4) === 'RIFF'
    && header.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

function ping(c: Context, format: Format): Response {
  return sendOk(c, {}, format)
}

function getLicense(c: Context, format: Format): Response {
  return sendOk(c, {
    license: {
      valid: true,
      email: 'tinggui@localhost',
      licenseExpires: '2099-12-31T00:00:00.000Z',
    },
  }, format)
}

function getOpenSubsonicExtensions(c: Context, format: Format): Response {
  // versions 是扩展协议要求的修订号。只有名字的话客户端不知道该按哪一版解析歌词。
  return sendOk(c, {
    openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }],
  }, format)
}

async function getUser(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const username = await readUser(deps.pool)
  return sendOk(c, {
    user: {
      username,
      scrobblingEnabled: true,
      adminRole: true,
      settingsRole: false,
      downloadRole: true,
      uploadRole: false,
      playlistRole: false,
      coverArtRole: false,
      commentRole: false,
      podcastRole: false,
      streamRole: true,
      jukeboxRole: false,
      shareRole: false,
      videoConversionRole: false,
      folder: [1],
    },
  }, format)
}

function getMusicFolders(c: Context, format: Format): Response {
  return sendOk(c, {
    musicFolders: {
      musicFolder: [{ id: 1, name: MUSIC_FOLDER_NAME }],
    },
  }, format)
}

async function getIndexes(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  if (!folderMatches(c.req.query('musicFolderId'))) {
    return sendOk(c, { indexes: { index: [] } }, format)
  }
  const groups = groupArtists(await listArtists(deps.pool))
  return sendOk(c, {
    indexes: {
      index: groups.map((group) => ({
        name: group.name,
        artist: group.artists.map((artist) => ({
          id: artistKey(artist.id),
          name: artist.name,
        })),
      })),
    },
  }, format)
}

async function getMusicDirectory(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const id = c.req.query('id')?.trim()
  if (!id) return missing(c, format)
  const parsed = parseDirectoryId(id)
  if (!parsed) return notFound(c, format)

  if (parsed.kind === 'root') {
    const artists = await listArtists(deps.pool)
    artists.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id))
    return sendOk(c, {
      directory: {
        id: MUSIC_FOLDER_ID,
        name: MUSIC_FOLDER_NAME,
        child: artists.map((artist) => ({
          id: artistKey(artist.id),
          parent: MUSIC_FOLDER_ID,
          isDir: true,
          title: artist.name,
          artist: artist.name,
        })),
      },
    }, format)
  }

  if (parsed.kind === 'artist') {
    const artist = await deps.pool.query<{ id: string; name: string }>(
      'SELECT id::text AS id, name FROM artists WHERE id = $1::bigint',
      [parsed.id],
    )
    const row = artist.rows[0]
    if (!row) return notFound(c, format)
    const albums = await albumsWhere(
      deps.pool,
      'WHERE al.album_artist_id = $1::bigint',
      'al.title ASC, al.id ASC',
      [parsed.id],
    )
    return sendOk(c, {
      directory: {
        id: artistKey(row.id),
        parent: MUSIC_FOLDER_ID,
        name: row.name,
        child: albums.map((album) => ({
          id: albumKey(album.id),
          parent: artistKey(row.id),
          isDir: true,
          title: album.title,
          album: album.title,
          artist: album.artist,
          coverArt: albumKey(album.id),
        })),
      },
    }, format)
  }

  const album = await deps.pool.query<{ id: string; title: string; artist_id: string }>(
    `SELECT al.id::text AS id, al.title, al.album_artist_id::text AS artist_id
     FROM albums al
     WHERE al.id = $1::bigint`,
    [parsed.id],
  )
  const row = album.rows[0]
  if (!row) return notFound(c, format)
  const songs = await songsWhere(deps.pool, 'WHERE s.album_id = $1::bigint', SONG_ORDER, [parsed.id])
  return sendOk(c, {
    directory: {
      id: albumKey(row.id),
      parent: artistKey(row.artist_id),
      name: row.title,
      child: songs.map((song) => songJson(song)),
    },
  }, format)
}

async function getArtists(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  if (!folderMatches(c.req.query('musicFolderId'))) {
    return sendOk(c, { artists: { index: [] } }, format)
  }
  const groups = groupArtists(await listArtists(deps.pool))
  return sendOk(c, {
    artists: {
      index: groups.map((group) => ({
        name: group.name,
        artist: group.artists.map((artist) => ({
          id: artistKey(artist.id),
          name: artist.name,
          albumCount: countOf(artist.album_count),
        })),
      })),
    },
  }, format)
}

async function getArtist(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const id = parseArtistId(c.req.query('id')?.trim())
  if (!c.req.query('id')?.trim()) return missing(c, format)
  if (!id) return notFound(c, format)
  const artist = await deps.pool.query<{ id: string; name: string }>(
    'SELECT id::text AS id, name FROM artists WHERE id = $1::bigint',
    [id],
  )
  const row = artist.rows[0]
  if (!row) return notFound(c, format)
  const albums = await albumsWhere(
    deps.pool,
    'WHERE al.album_artist_id = $1::bigint',
    'al.title ASC, al.id ASC',
    [id],
  )
  return sendOk(c, {
    artist: {
      id: artistKey(row.id),
      name: row.name,
      albumCount: albums.length,
      album: albums.map((album) => albumJson(album)),
    },
  }, format)
}

async function getAlbum(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const raw = c.req.query('id')?.trim()
  if (!raw) return missing(c, format)
  const id = parseAlbumId(raw)
  if (!id) return notFound(c, format)
  const albums = await albumsWhere(deps.pool, 'WHERE al.id = $1::bigint', 'al.id ASC', [id])
  const album = albums[0]
  if (!album) return notFound(c, format)
  const songs = await songsWhere(deps.pool, 'WHERE s.album_id = $1::bigint', SONG_ORDER, [id])
  return sendOk(c, {
    album: {
      ...albumJson(album),
      song: songs.map((song) => songJson(song)),
    },
  }, format)
}

async function getSong(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const raw = c.req.query('id')?.trim()
  if (!raw) return missing(c, format)
  const id = parseSongId(raw)
  if (!id) return notFound(c, format)
  const songs = await songsWhere(deps.pool, 'WHERE s.id = $1::bigint', 's.id ASC', [id])
  const song = songs[0]
  if (!song) return notFound(c, format)
  return sendOk(c, { song: songJson(song) }, format)
}

async function getAlbumList2(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const type = c.req.query('type')?.trim()
  if (!type) return missing(c, format)
  const empty = sendOk(c, { albumList2: { album: [] } }, format)
  // 库里没有年份、风格、评分。这几类给空列表，状态仍是成功。
  if (type === 'byYear' || type === 'byGenre' || type === 'highest') return empty
  if (!folderMatches(c.req.query('musicFolderId'))) return empty

  // 协议单次最多 500。不封顶的话一次请求会把整库专辑都吐出去。
  const size = bounded(c.req.query('size'), 10, 500)
  const offset = bounded(c.req.query('offset'), 0, 1_000_000)
  let where = ''
  let orderBy = 'al.title ASC, al.id ASC'
  if (type === 'alphabeticalByName') {
    orderBy = 'al.title ASC, al.id ASC'
  } else if (type === 'alphabeticalByArtist') {
    orderBy = 'ar.name ASC, al.title ASC, al.id ASC'
  } else if (type === 'newest') {
    where = 'WHERE EXISTS (SELECT 1 FROM songs s WHERE s.album_id = al.id)'
    orderBy = '(SELECT MAX(s.created_at) FROM songs s WHERE s.album_id = al.id) DESC NULLS LAST, al.id DESC'
  } else if (type === 'recent') {
    where = `WHERE EXISTS (
      SELECT 1 FROM scrobbles sc
      JOIN songs s ON s.id = sc.song_id
      WHERE s.album_id = al.id
    )`
    orderBy = `(
      SELECT MAX(sc.played_at) FROM scrobbles sc
      JOIN songs s ON s.id = sc.song_id
      WHERE s.album_id = al.id
    ) DESC, al.id DESC`
  } else if (type === 'frequent') {
    where = `WHERE (
      SELECT COUNT(*) FROM scrobbles sc
      JOIN songs s ON s.id = sc.song_id
      WHERE s.album_id = al.id
    ) > 0`
    orderBy = `(
      SELECT COUNT(*) FROM scrobbles sc
      JOIN songs s ON s.id = sc.song_id
      WHERE s.album_id = al.id
    ) DESC, al.id ASC`
  } else if (type === 'random') {
    orderBy = 'random(), al.id ASC'
  } else if (type === 'starred') {
    where = `JOIN stars st ON st.target_type = 'album' AND st.target_id = al.id`
    orderBy = 'st.created_at DESC, al.id ASC'
  } else {
    return empty
  }

  // albumsWhere 会自己加 ORDER BY。LIMIT 跟在排序后面，占 $1 $2。
  const albums = await albumsWhere(deps.pool, where, `${orderBy} LIMIT $1 OFFSET $2`, [size, offset])
  return sendOk(c, {
    albumList2: { album: albums.map((album) => albumJson(album)) },
  }, format)
}

async function getStarred2(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  if (!folderMatches(c.req.query('musicFolderId'))) {
    return sendOk(c, { starred2: { artist: [], album: [], song: [] } }, format)
  }
  const artists = await deps.pool.query<ArtistRow & { starred_at: Date }>(
    `SELECT ar.id::text AS id,
            ar.name,
            (SELECT COUNT(*)::int FROM albums al WHERE al.album_artist_id = ar.id) AS album_count,
            st.created_at AS starred_at
     FROM stars st
     JOIN artists ar ON ar.id = st.target_id
     WHERE st.target_type = 'artist'
     ORDER BY st.created_at DESC, ar.id ASC`,
  )
  const albums = await deps.pool.query<AlbumRow & { starred_at: Date }>(
    `SELECT ${ALBUM_FIELDS},
            st.created_at AS starred_at
     FROM albums al
     JOIN artists ar ON ar.id = al.album_artist_id
     JOIN stars st ON st.target_type = 'album' AND st.target_id = al.id
     ORDER BY st.created_at DESC, al.id ASC`,
  )
  const songs = await deps.pool.query<SongRow & { starred_at: Date }>(
    `SELECT ${SONG_FIELDS},
            st.created_at AS starred_at
     ${SONG_FROM}
     JOIN stars st ON st.target_type = 'song' AND st.target_id = s.id
     ORDER BY st.created_at DESC, s.id ASC`,
  )
  return sendOk(c, {
    starred2: {
      artist: artists.rows.map((artist) => ({
        id: artistKey(artist.id),
        name: artist.name,
        albumCount: countOf(artist.album_count),
        starred: isoTime(artist.starred_at),
      })),
      album: albums.rows.map((album) => albumJson(album, isoTime(album.starred_at))),
      song: songs.rows.map((song) => songJson(song, isoTime(song.starred_at))),
    },
  }, format)
}

async function getRandomSongs(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  if (!folderMatches(c.req.query('musicFolderId'))) {
    return sendOk(c, { randomSongs: { song: [] } }, format)
  }
  const size = bounded(c.req.query('size'), 10, 50)
  const result = await deps.pool.query<SongRow>(
    `SELECT ${SONG_FIELDS}
     ${SONG_FROM}
     ORDER BY random(), s.id ASC
     LIMIT $1`,
    [size],
  )
  return sendOk(c, {
    randomSongs: { song: result.rows.map((song) => songJson(song)) },
  }, format)
}

async function play(
  c: Context,
  deps: SubsonicDeps,
  openSong: OpenSong,
  playback: PlaybackSettings,
): Promise<Response> {
  await loadPlayback(deps.pool, playback)
  const id = c.req.query('id') ?? ''
  return openSong.open(id, c.req.header('range'))
}

async function getCoverArt(c: Context, deps: SubsonicDeps): Promise<Response> {
  const albumId = parseAlbumId(c.req.query('id')?.trim())
  if (!albumId) return new Response(null, { status: 404 })
  const found = await coverFile({
    pool: deps.pool,
    albumId,
    dataDir: deps.dataDir,
    fetchPic: getPicForMusic,
  })
  if (!found) return new Response(null, { status: 404 })
  try {
    const bytes = await readFile(found.path)
    if (bytes.length === 0) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': imageContentType(bytes.subarray(0, 16)),
        'Content-Length': String(bytes.length),
      },
    })
  } catch {
    // 路径刚被搬走时不再抛 500。封面这次没有，歌曲还在。
    return new Response(null, { status: 404 })
  }
}

async function getLyrics(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const artist = c.req.query('artist') ?? ''
  const title = c.req.query('title') ?? ''
  if (!artist.trim() || !title.trim()) return sendOk(c, { lyrics: {} }, format)
  const found = await deps.pool.query<{ id: string }>(
    `SELECT s.id::text AS id
     ${SONG_FROM}
     WHERE s.title = $1
       AND (
         COALESCE((
           SELECT string_agg(ar.name, '、' ORDER BY sa.position)
           FROM song_artists sa
           JOIN artists ar ON ar.id = sa.artist_id
           WHERE sa.song_id = s.id
         ), '') = $2
         OR EXISTS (
           SELECT 1
           FROM song_artists sa
           JOIN artists ar ON ar.id = sa.artist_id
           WHERE sa.song_id = s.id AND ar.name = $2
         )
       )
     ORDER BY s.id ASC
     LIMIT 1`,
    [title, artist],
  )
  const songId = found.rows[0]?.id
  if (!songId) return sendOk(c, { lyrics: {} }, format)
  const text = await lyricText({
    pool: deps.pool,
    songId,
    fetchLyric: getLyricForMusic,
  })
  if (!text.lyric.trim()) return sendOk(c, { lyrics: {} }, format)
  return sendOk(c, {
    lyrics: { artist, title, value: text.lyric },
  }, format)
}

async function getLyricsBySongId(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const raw = c.req.query('id')?.trim()
  if (!raw) return missing(c, format)
  const id = parseSongId(raw)
  if (!id) return notFound(c, format)
  const songs = await songsWhere(deps.pool, 'WHERE s.id = $1::bigint', 's.id ASC', [id])
  const song = songs[0]
  if (!song) return notFound(c, format)
  const text = await lyricText({
    pool: deps.pool,
    songId: id,
    fetchLyric: getLyricForMusic,
  })
  const structuredLyrics: Record<string, unknown>[] = []
  if (text.lyric.trim()) {
    structuredLyrics.push(structuredLyric(song.artist, song.title, text.lyric))
    // 译文单独一条。空字符串不是译文，避免客户端多出一页空白。
    if (text.tlyric.trim()) structuredLyrics.push(structuredLyric(song.artist, song.title, text.tlyric))
  }
  return sendOk(c, { lyricsList: { structuredLyrics } }, format)
}

/**
 * 播放地址缓存在这一份 openSong 上。每个请求新建的话，拖动进度条会反复问脚本要地址。
 */
export function mountSubsonic(app: Hono, deps: SubsonicDeps): void {
  const playback: PlaybackSettings = {
    order: [...SOURCES],
    quality: '128k',
  }
  const openSong = createOpenSong({
    pool: deps.pool,
    getMusicUrl: deps.getMusicUrl,
    sourceOrder: () => playback.order,
    wantedQuality: () => playback.quality,
    getStatus: () => deps.getStatus(),
  })

  const views: Record<string, View> = {
    ping,
    getLicense,
    getOpenSubsonicExtensions,
    getUser: (c, format) => getUser(c, deps, format),
    getMusicFolders,
    getIndexes: (c, format) => getIndexes(c, deps, format),
    getMusicDirectory: (c, format) => getMusicDirectory(c, deps, format),
    getArtists: (c, format) => getArtists(c, deps, format),
    getArtist: (c, format) => getArtist(c, deps, format),
    getAlbum: (c, format) => getAlbum(c, deps, format),
    getSong: (c, format) => getSong(c, deps, format),
    getAlbumList2: (c, format) => getAlbumList2(c, deps, format),
    getStarred2: (c, format) => getStarred2(c, deps, format),
    getRandomSongs: (c, format) => getRandomSongs(c, deps, format),
    stream: (c) => play(c, deps, openSong, playback),
    download: (c) => play(c, deps, openSong, playback),
    getCoverArt: (c) => getCoverArt(c, deps),
    getLyrics: (c, format) => getLyrics(c, deps, format),
    getLyricsBySongId: (c, format) => getLyricsBySongId(c, deps, format),
  }

  app.get('/rest/:view', async (c) => {
    const view = c.req.param('view')
    if (!view.endsWith('.view')) return c.notFound()
    const name = view.slice(0, -'.view'.length)
    const handler = views[name]
    // 口令密钥对不上时 requireSubsonic 会抛。这里不接住，不能把它写成错误码 40。
    const auth = await requireSubsonic(c, deps)
    if (auth instanceof Response) return auth
    if (!handler) return sendErr(c, 0, 'Not implemented', auth.format)
    return handler(c, auth.format)
  })
}
