import type { MusicInfo, OnlineSource } from '../types.js'
import rawSdk from '../sdk/musicSdk/index.js'

export type LyricResult = {
  lyric: string
  tlyric: string
}

/** Rebuild lx-music “old” musicInfo fields expected by platform lyric/pic modules. */
export function toOldMusicInfo(musicInfo: MusicInfo): Record<string, unknown> {
  const meta = musicInfo.meta ?? {}
  const songmid =
    meta.songId ??
    meta.songmid ??
    (typeof musicInfo.id === 'string' && musicInfo.id.includes('_')
      ? musicInfo.id.replace(/^[^_]+_/, '').split('_')[0]
      : musicInfo.id)

  return {
    name: musicInfo.name,
    singer: musicInfo.singer,
    source: musicInfo.source,
    songmid,
    songId: meta.id ?? meta.songId ?? songmid,
    hash: meta.hash,
    albumId: meta.albumId || meta.albumMid,
    albumMid: meta.albumMid || meta.albumId,
    albumAudioId: meta.albumAudioId,
    audioId: meta.albumAudioId ?? musicInfo.id,
    strMediaMid: meta.strMediaMid,
    copyrightId: meta.copyrightId,
    lrcUrl: meta.lrcUrl,
    mrcUrl: meta.mrcUrl,
    trcUrl: meta.trcUrl,
    interval: musicInfo.interval,
    _interval: musicInfo.interval,
    img: meta.picUrl,
  }
}

async function unwrapSdkResult(raw: unknown): Promise<unknown> {
  let data = raw
  if (data instanceof Promise) data = await data
  if (data && typeof data === 'object' && 'promise' in data) {
    const p = (data as { promise?: Promise<unknown> }).promise
    if (p) data = await p
  }
  if (data instanceof Promise) data = await data
  return data
}

async function awaitLyricPayload(raw: unknown): Promise<Record<string, unknown>> {
  const data = await unwrapSdkResult(raw)
  if (!data || typeof data !== 'object') throw new Error('歌词为空')
  return data as Record<string, unknown>
}

export async function getLyricForMusic(musicInfo: MusicInfo): Promise<LyricResult> {
  const source = String(musicInfo.source) as OnlineSource
  const mod = (rawSdk as any)[source]
  if (!mod?.getLyric) throw new Error(`音源 ${source} 不支持歌词`)

  const oldInfo = toOldMusicInfo(musicInfo)
  const payload = await awaitLyricPayload(mod.getLyric(oldInfo))
  const lyric = String(payload.lyric ?? '')
  const tlyric = String(payload.tlyric ?? '')
  if (!lyric.trim()) throw new Error('未找到歌词')
  return { lyric, tlyric }
}

export { unwrapSdkResult }
