import type { OnlineSource } from '../types.js'

/**
 * 刮削曲目收成入库形状。
 * 音轨号和碟号留给本地标签；在线曲目经常没有这两项，所以允许空。
 */
export type IngestTrack = {
  platform: OnlineSource
  platformSongId: string
  title: string
  singers: string[]
  albumTitle: string
  albumPlatformId: string | null
  durationMs: number | null
  trackNo: number | null
  discNo: number | null
  coverUrl: string | null
  raw: unknown
}
