import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool, PoolClient } from 'pg'
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
      // 用户歌单的创建和修改在这项里。false 时客户端不放出编辑。
      playlistRole: true,
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

const SEARCH_CAP = 500
const READ_ONLY_PLAYLIST = 'subscription playlist is read-only'

type PlaylistRow = {
  id: string
  kind: string
  name: string
  created_at: Date | string
  updated_at: Date | string
  song_count: number | string
  duration_ms: number | string | null
}

type Queryable = Pick<Pool | PoolClient, 'query'>

/**
 * 改名和换成员必须同一事务。
 * 回滚失败的连接不能还回池里，否则下一笔会接着脏事务。
 */
async function withTx<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
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
        broken = rollbackErr instanceof Error ? rollbackErr : new Error('rollback failed')
      }
      throw err
    }
  } finally {
    client.release(broken)
  }
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23503'
}

/** 参数没出现和出现了但值为空要分开。queries() 把两种都收成空数组。 */
function queryValues(c: Context, key: string): string[] | undefined {
  const raw = c.req.url
  const query = raw.split('#')[0]?.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  if (!params.has(key)) return undefined
  return params.getAll(key)
}

/**
 * 空白的单独一项表示清空。夹在有效 id 里的空值整单拒绝，避免悄悄少一首。
 * 解析失败返回 null，调用方按找不到处理，不把非法 id 送进 ::bigint。
 */
function parseSongIdList(values: string[]): string[] | null {
  if (values.length === 1 && values[0]?.trim() === '') return []
  const ids: string[] = []
  for (const value of values) {
    const id = parseSongId(value.trim())
    if (!id) return null
    ids.push(id)
  }
  return ids
}

function parseTargetIds(
  values: string[] | undefined,
  parse: (raw: string | undefined) => string | null,
): string[] | null {
  if (!values) return []
  const ids: string[] = []
  for (const value of values) {
    const id = parse(value.trim())
    if (!id) return null
    ids.push(id)
  }
  return ids
}

/**
 * 曲库里没有的 id 不写进去。stars 没有外键，写了会变成看不见的收藏。
 * 表名只来自下面三个字面量，不是请求参数。
 */
async function libraryIdsExist(
  pool: Pool,
  table: 'songs' | 'albums' | 'artists',
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true
  const distinct = [...new Set(ids)]
  const result = await pool.query<{ n: number | string }>(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE id::text = ANY($1::text[])`,
    [distinct],
  )
  return countOf(result.rows[0]?.n ?? 0) === distinct.length
}

async function missingSongIds(db: Queryable, songIds: string[]): Promise<boolean> {
  if (songIds.length === 0) return false
  const distinct = [...new Set(songIds)]
  const result = await db.query(
    `SELECT 1
     FROM unnest($1::text[]) AS t(song_id)
     LEFT JOIN songs s ON s.id = t.song_id::bigint
     WHERE s.id IS NULL
     LIMIT 1`,
    [distinct],
  )
  return (result.rowCount ?? 0) > 0
}

const PLAYLIST_FIELDS = `
p.id::text AS id,
p.kind,
p.name,
p.created_at,
p.updated_at,
COUNT(pi.song_id)::int AS song_count,
COALESCE(SUM(s.duration_ms), 0)::bigint AS duration_ms
`

async function loadPlaylist(db: Queryable, id: string): Promise<PlaylistRow | null> {
  const result = await db.query<PlaylistRow>(
    `SELECT ${PLAYLIST_FIELDS}
     FROM playlists p
     LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
     LEFT JOIN songs s ON s.id = pi.song_id
     WHERE p.id = $1::bigint
     GROUP BY p.id`,
    [id],
  )
  return result.rows[0] ?? null
}

async function playlistSongs(db: Queryable, playlistId: string): Promise<SongRow[]> {
  const result = await db.query<SongRow>(
    `SELECT ${SONG_FIELDS}
     ${SONG_FROM}
     JOIN playlist_items pi ON pi.song_id = s.id
     WHERE pi.playlist_id = $1::bigint
     ORDER BY pi.position ASC`,
    [playlistId],
  )
  return result.rows
}

/**
 * 订阅歌单只读，用 comment 标出来。
 * 用户歌单不带 comment。changed 用库里的 updated_at，不另算时间。
 */
function playlistJson(
  row: PlaylistRow,
  owner: string,
  entries?: Record<string, unknown>[],
): Record<string, unknown> {
  const playlist: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    owner,
    public: false,
    songCount: countOf(row.song_count),
    duration: durationSeconds(row.duration_ms),
    created: isoTime(row.created_at),
    changed: isoTime(row.updated_at),
  }
  if (row.kind === 'subscription') playlist.comment = 'subscription'
  if (entries) playlist.entry = entries
  return playlist
}

/** position 从 0 起，和订阅刷新写入 playlist_items 的顺序一致。重复的 songId 各占一位。 */
async function replacePlaylistItems(client: PoolClient, playlistId: string, songIds: string[]): Promise<void> {
  await client.query('DELETE FROM playlist_items WHERE playlist_id = $1::bigint', [playlistId])
  if (songIds.length === 0) return
  await client.query(
    `INSERT INTO playlist_items (playlist_id, position, song_id)
     SELECT $1::bigint, ordinality - 1, song_id::bigint
     FROM unnest($2::text[]) WITH ORDINALITY AS t(song_id, ordinality)`,
    [playlistId, songIds],
  )
}

async function getPlaylists(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const owner = await readUser(deps.pool)
  const result = await deps.pool.query<PlaylistRow>(
    `SELECT ${PLAYLIST_FIELDS}
     FROM playlists p
     LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
     LEFT JOIN songs s ON s.id = pi.song_id
     GROUP BY p.id
     ORDER BY p.id ASC`,
  )
  return sendOk(c, {
    playlists: {
      playlist: result.rows.map((row) => playlistJson(row, owner)),
    },
  }, format)
}

async function getPlaylist(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const raw = c.req.query('id')?.trim()
  if (!raw) return missing(c, format)
  const id = parseSongId(raw)
  if (!id) return notFound(c, format)
  const row = await loadPlaylist(deps.pool, id)
  if (!row) return notFound(c, format)
  const owner = await readUser(deps.pool)
  const songs = await playlistSongs(deps.pool, id)
  return sendOk(c, {
    playlist: playlistJson(row, owner, songs.map((song) => songJson(song))),
  }, format)
}

async function createPlaylist(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const rawName = c.req.query('name')
  // 缺省或空白在列表里没有名字，用固定标题，避免客户端画出一行空的。
  const name = rawName == null || rawName.trim() === '' ? '新建歌单' : rawName.trim()
  const listed = queryValues(c, 'songId') ?? []
  const songIds = parseSongIdList(listed)
  if (!songIds) return notFound(c, format)
  if (await missingSongIds(deps.pool, songIds)) return notFound(c, format)
  const owner = await readUser(deps.pool)
  let playlistId: string
  try {
    playlistId = await withTx(deps.pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO playlists (kind, name)
         VALUES ('user', $1)
         RETURNING id::text AS id`,
        [name],
      )
      const id = inserted.rows[0]?.id
      if (!id) throw new Error('playlist missing after insert')
      await replacePlaylistItems(client, id, songIds)
      return id
    })
  } catch (err) {
    if (isForeignKeyViolation(err)) return notFound(c, format)
    throw err
  }
  const row = await loadPlaylist(deps.pool, playlistId)
  if (!row) return notFound(c, format)
  const songs = await playlistSongs(deps.pool, playlistId)
  return sendOk(c, {
    playlist: playlistJson(row, owner, songs.map((song) => songJson(song))),
  }, format)
}

async function updatePlaylist(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const rawId = c.req.query('playlistId')?.trim()
  if (!rawId) return missing(c, format)
  const id = parseSongId(rawId)
  if (!id) return notFound(c, format)
  const found = await deps.pool.query<{ kind: string }>(
    'SELECT kind FROM playlists WHERE id = $1::bigint',
    [id],
  )
  const kind = found.rows[0]?.kind
  if (!kind) return notFound(c, format)
  // 订阅成员只走刷新。这里改名或换歌会把在线歌单和库里的列表拆开。
  if (kind === 'subscription') return sendErr(c, 50, READ_ONLY_PLAYLIST, format)

  const nameRaw = c.req.query('name')
  const nextName = nameRaw === undefined ? undefined : nameRaw.trim()
  const rename = nextName !== undefined && nextName !== ''
  const songValues = queryValues(c, 'songId')
  let songIds: string[] | undefined
  if (songValues !== undefined) {
    const parsed = parseSongIdList(songValues)
    if (!parsed) return notFound(c, format)
    if (await missingSongIds(deps.pool, parsed)) return notFound(c, format)
    songIds = parsed
  }
  if (!rename && songIds === undefined) return sendOk(c, {}, format)

  try {
    const applied = await withTx(deps.pool, async (client) => {
      // 检查之后若行没了，不能把编辑写到别的歌单上。
      const still = await client.query<{ kind: string }>(
        'SELECT kind FROM playlists WHERE id = $1::bigint FOR UPDATE',
        [id],
      )
      if (still.rows[0]?.kind !== 'user') return false
      if (songIds !== undefined) await replacePlaylistItems(client, id, songIds)
      if (rename) {
        await client.query(
          `UPDATE playlists
           SET name = $2, updated_at = now()
           WHERE id = $1::bigint AND kind = 'user'`,
          [id, nextName],
        )
      } else {
        await client.query(
          `UPDATE playlists
           SET updated_at = now()
           WHERE id = $1::bigint AND kind = 'user'`,
          [id],
        )
      }
      return true
    })
    if (!applied) return notFound(c, format)
  } catch (err) {
    if (isForeignKeyViolation(err)) return notFound(c, format)
    throw err
  }
  return sendOk(c, {}, format)
}

async function deletePlaylist(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const raw = c.req.query('id')?.trim()
  if (!raw) return missing(c, format)
  const id = parseSongId(raw)
  if (!id) return notFound(c, format)
  const found = await deps.pool.query<{ kind: string }>(
    'SELECT kind FROM playlists WHERE id = $1::bigint',
    [id],
  )
  const kind = found.rows[0]?.kind
  if (!kind) return notFound(c, format)
  if (kind === 'subscription') return sendErr(c, 50, READ_ONLY_PLAYLIST, format)
  // 只删歌单行。playlist_items 随外键级联，歌曲和文件留着。
  await deps.pool.query(
    `DELETE FROM playlists WHERE id = $1::bigint AND kind = 'user'`,
    [id],
  )
  return sendOk(c, {}, format)
}

/**
 * 只查 Postgres。在线搜索不是 Subsonic 的 search2 / search3。
 * 一个搜索框对着歌名、专辑名、歌手名，所以歌曲和专辑不只匹配自己的标题。
 */
async function searchLibrary(
  c: Context,
  deps: SubsonicDeps,
  format: Format,
  key: 'searchResult2' | 'searchResult3',
): Promise<Response> {
  const query = c.req.query('query')
  if (query === undefined) return missing(c, format)
  const empty = { artist: [], album: [], song: [] }
  // 只有 1 号文件夹是这座库。别的编号不能把整库搜出来冒充。
  if (!folderMatches(c.req.query('musicFolderId'))) {
    return sendOk(c, { [key]: empty }, format)
  }
  // 协议默认各 20。不封顶的话一次请求会把整库吐出去。翻页用 offset，缺省从 0 开始。
  const artistCount = bounded(c.req.query('artistCount'), 20, SEARCH_CAP)
  const albumCount = bounded(c.req.query('albumCount'), 20, SEARCH_CAP)
  const songCount = bounded(c.req.query('songCount'), 20, SEARCH_CAP)
  const artistOffset = bounded(c.req.query('artistOffset'), 0, 1_000_000)
  const albumOffset = bounded(c.req.query('albumOffset'), 0, 1_000_000)
  const songOffset = bounded(c.req.query('songOffset'), 0, 1_000_000)

  const artists = artistCount === 0
    ? []
    : (await deps.pool.query<ArtistRow>(
      `SELECT ar.id::text AS id,
              ar.name,
              (SELECT COUNT(*)::int FROM albums al WHERE al.album_artist_id = ar.id) AS album_count
       FROM artists ar
       WHERE ar.name ILIKE '%' || $1 || '%'
       ORDER BY ar.name ASC, ar.id ASC
       LIMIT $2 OFFSET $3`,
      [query, artistCount, artistOffset],
    )).rows
  const albums = albumCount === 0
    ? []
    : await albumsWhere(
      deps.pool,
      `WHERE al.title ILIKE '%' || $1 || '%' OR ar.name ILIKE '%' || $1 || '%'`,
      'al.title ASC, al.id ASC LIMIT $2 OFFSET $3',
      [query, albumCount, albumOffset],
    )
  const songs = songCount === 0
    ? []
    : await songsWhere(
      deps.pool,
      `WHERE s.title ILIKE '%' || $1 || '%'
          OR al.title ILIKE '%' || $1 || '%'
          OR aa.name ILIKE '%' || $1 || '%'
          OR EXISTS (
            SELECT 1
            FROM song_artists sa
            JOIN artists ar ON ar.id = sa.artist_id
            WHERE sa.song_id = s.id
              AND ar.name ILIKE '%' || $1 || '%'
          )`,
      's.title ASC, s.id ASC LIMIT $2 OFFSET $3',
      [query, songCount, songOffset],
    )
  return sendOk(c, {
    [key]: {
      artist: artists.map((artist) => ({
        id: artistKey(artist.id),
        name: artist.name,
        albumCount: countOf(artist.album_count),
      })),
      album: albums.map((album) => albumJson(album)),
      song: songs.map((song) => songJson(song)),
    },
  }, format)
}

async function writeStars(
  pool: Pool,
  songs: string[],
  albums: string[],
  artists: string[],
  mode: 'insert' | 'delete',
): Promise<void> {
  const groups = [
    ['song', songs],
    ['album', albums],
    ['artist', artists],
  ] as const
  await withTx(pool, async (client) => {
    for (const [type, ids] of groups) {
      if (ids.length === 0) continue
      // 同一次请求里的重复 id 会在一条 INSERT 里自己撞主键。先收成一行。
      const unique = [...new Set(ids)]
      if (mode === 'insert') {
        await client.query(
          `INSERT INTO stars (target_type, target_id)
           SELECT $1, id::bigint
           FROM unnest($2::text[]) AS t(id)
           ON CONFLICT DO NOTHING`,
          [type, unique],
        )
      } else {
        await client.query(
          `DELETE FROM stars
           WHERE target_type = $1 AND target_id::text = ANY($2::text[])`,
          [type, unique],
        )
      }
    }
  })
}

function starTargets(c: Context): { songs: string[]; albums: string[]; artists: string[] } | null {
  const songs = parseTargetIds(queryValues(c, 'id'), parseSongId)
  const albums = parseTargetIds(queryValues(c, 'albumId'), parseAlbumId)
  const artists = parseTargetIds(queryValues(c, 'artistId'), parseArtistId)
  if (!songs || !albums || !artists) return null
  return { songs, albums, artists }
}

async function star(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const targets = starTargets(c)
  if (!targets) return notFound(c, format)
  const { songs, albums, artists } = targets
  if (songs.length + albums.length + artists.length === 0) return missing(c, format)
  if (!(await libraryIdsExist(deps.pool, 'songs', songs))) return notFound(c, format)
  if (!(await libraryIdsExist(deps.pool, 'albums', albums))) return notFound(c, format)
  if (!(await libraryIdsExist(deps.pool, 'artists', artists))) return notFound(c, format)
  await writeStars(deps.pool, songs, albums, artists, 'insert')
  return sendOk(c, {}, format)
}

async function unstar(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const targets = starTargets(c)
  if (!targets) return notFound(c, format)
  const { songs, albums, artists } = targets
  if (songs.length + albums.length + artists.length === 0) return missing(c, format)
  // 没收藏过也算成功。重复取消不能让客户端当成失败。
  await writeStars(deps.pool, songs, albums, artists, 'delete')
  return sendOk(c, {}, format)
}

/** 没给 time 时用现在。给了就按毫秒时间戳，对不上就仍然用现在，不把坏时间写成 1970。 */
function scrobbleInstant(raw: string | undefined): string | null {
  if (raw == null || raw.trim() === '') return null
  if (!/^\d+$/.test(raw.trim())) return null
  const ms = Number(raw.trim())
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

async function scrobble(c: Context, deps: SubsonicDeps, format: Format): Promise<Response> {
  const idValues = queryValues(c, 'id')
  if (!idValues || idValues.length === 0) return missing(c, format)
  const songIds = parseSongIdList(idValues)
  if (!songIds || songIds.length === 0) return notFound(c, format)
  // 只有明确的 false 表示正在播放。这时成功返回，不写 scrobbles。
  if (c.req.query('submission')?.trim() === 'false') return sendOk(c, {}, format)
  if (await missingSongIds(deps.pool, songIds)) return notFound(c, format)
  const times = queryValues(c, 'time') ?? []
  try {
    await withTx(deps.pool, async (client) => {
      for (let i = 0; i < songIds.length; i++) {
        const at = scrobbleInstant(times[i])
        if (at) {
          await client.query(
            `INSERT INTO scrobbles (song_id, played_at) VALUES ($1::bigint, $2::timestamptz)`,
            [songIds[i], at],
          )
        } else {
          await client.query(
            `INSERT INTO scrobbles (song_id) VALUES ($1::bigint)`,
            [songIds[i]],
          )
        }
      }
    })
  } catch (err) {
    if (isForeignKeyViolation(err)) return notFound(c, format)
    throw err
  }
  return sendOk(c, {}, format)
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
    getPlaylists: (c, format) => getPlaylists(c, deps, format),
    getPlaylist: (c, format) => getPlaylist(c, deps, format),
    createPlaylist: (c, format) => createPlaylist(c, deps, format),
    updatePlaylist: (c, format) => updatePlaylist(c, deps, format),
    deletePlaylist: (c, format) => deletePlaylist(c, deps, format),
    search2: (c, format) => searchLibrary(c, deps, format, 'searchResult2'),
    search3: (c, format) => searchLibrary(c, deps, format, 'searchResult3'),
    star: (c, format) => star(c, deps, format),
    unstar: (c, format) => unstar(c, deps, format),
    scrobble: (c, format) => scrobble(c, deps, format),
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
