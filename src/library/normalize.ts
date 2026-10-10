import type { MusicInfo, OnlineSource } from '../types.js'
import type { IngestTrack } from './types.js'

const PLATFORMS: readonly OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']

/** 展示名先收空白。空串留给调用方填默认名，这里不写「未知歌手」。 */
export function collapseSpace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** 刮削把多位歌手拼进一个字段，分隔符就是这三种。 */
export function splitSingers(singer: string): string[] {
  return singer
    .split(/[/、,]/)
    .map((part) => collapseSpace(part))
    .filter((part) => part.length > 0)
}

/**
 * formatPlayTime 的输入是秒，0 秒写成 `--/--`，其余写成 `mm:ss`。
 * 分钟超过 99 时不会截成两位，所以分钟位不限长度。
 * 刮削进 MusicInfo 之后 interval 经常已是这种字符串；数字形态仍按秒计。
 */
export function durationMs(interval: unknown): number | null {
  if (typeof interval === 'number') {
    if (!Number.isFinite(interval)) return null
    return Math.round(interval * 1000)
  }
  if (typeof interval !== 'string') return null
  const text = interval.trim()
  if (text === '' || text === '--/--') return null
  const clock = /^(\d+):(\d{2})$/.exec(text)
  if (!clock) return null
  const minutes = Number(clock[1])
  const seconds = Number(clock[2])
  if (seconds >= 60) return null
  return (minutes * 60 + seconds) * 1000
}

function isPlatform(source: MusicInfo['source']): source is OnlineSource {
  return (PLATFORMS as readonly string[]).includes(source)
}

/**
 * 平台专辑 id 要非空文本。酷狗、网易的 albumId 经常是数字，收成十进制字符串才能写入 text 列。
 */
function platformAlbumId(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return String(value)
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

/** 封面只收 http(s)，避免把脚本或相对路径写进专辑。 */
function httpCover(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return /^https?:\/\//i.test(text) ? text : null
}

export function ingestTrackFromMusic(music: MusicInfo): IngestTrack {
  if (!isPlatform(music.source)) throw new Error('unsupported source')
  const platform = music.source
  // 酷狗 id 已是 songmid_hash。其余平台是 source_songmid，只去掉这一段前缀。
  const prefix = `${platform}_`
  const platformSongId = platform === 'kg'
    ? music.id
    : music.id.startsWith(prefix)
      ? music.id.slice(prefix.length)
      : music.id
  const title = collapseSpace(music.name)
  return {
    platform,
    platformSongId,
    title: title.length > 0 ? title : '未知歌曲',
    singers: splitSingers(music.singer),
    albumTitle: collapseSpace(String(music.meta.albumName ?? '')),
    albumPlatformId: platformAlbumId(music.meta.albumId) ?? platformAlbumId(music.meta.albumMid),
    durationMs: durationMs(music.interval),
    trackNo: null,
    discNo: null,
    coverUrl: httpCover(music.meta.picUrl),
    raw: music,
  }
}
