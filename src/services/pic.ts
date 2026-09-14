import type { MusicInfo, OnlineSource } from '../types.js'
import rawSdk from '../sdk/musicSdk/index.js'
import { toOldMusicInfo, unwrapSdkResult } from './lyrics.js'

export async function getPicForMusic(musicInfo: MusicInfo): Promise<string | null> {
  const existing = String(musicInfo.meta?.picUrl || '')
  if (existing && existing !== 'null') return existing

  const source = String(musicInfo.source) as OnlineSource
  const mod = (rawSdk as any)[source]
  if (!mod?.getPic) return null

  try {
    const oldInfo = toOldMusicInfo(musicInfo)
    if (!oldInfo.audioId) oldInfo.audioId = musicInfo.id
    const raw = await unwrapSdkResult(mod.getPic(oldInfo))
    const url = typeof raw === 'string' ? raw : String((raw as { url?: string })?.url || '')
    return url && url !== 'null' ? url : null
  } catch {
    return null
  }
}

export async function ensureMusicPic(musicInfo: MusicInfo): Promise<MusicInfo> {
  const picUrl = await getPicForMusic(musicInfo)
  if (!picUrl) return musicInfo
  return {
    ...musicInfo,
    meta: {
      ...musicInfo.meta,
      picUrl,
    },
  }
}
