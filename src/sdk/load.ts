import { toNewMusicInfo } from '../lib/toNewMusicInfo.js'
import type { MusicInfo, OnlineSource } from '../types.js'
import rawSdk from './musicSdk/index.js'

export type SdkSourceModule = {
  musicSearch: {
    search: (
      q: string,
      page: number,
      limit: number,
    ) => Promise<{ list: MusicInfo[]; total: number; allPage?: number; limit?: number; source?: string }>
  }
  songList: {
    getListDetail: (
      id: string,
      page: number,
    ) => Promise<{
      list: any[]
      page: number
      limit: number
      total: number
      source: string
      info: { name: string; img?: string; desc?: string; author?: string }
    }>
  }
  getMusicUrl: (...args: any[]) => never
}

function wrapSource(mod: any): SdkSourceModule {
  return {
    musicSearch: {
      async search(q: string, page: number, limit: number) {
        const res = await mod.musicSearch.search(q, page, limit)
        return {
          ...res,
          list: (res.list ?? []).map((item: any) => toNewMusicInfo(item)),
        }
      },
    },
    songList: {
      getListDetail: (id: string, page: number) => mod.songList.getListDetail(id, page),
    },
    getMusicUrl() {
      throw new Error('use userApi')
    },
  }
}

const sources: OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']

export const sdk: Record<string, SdkSourceModule> = Object.fromEntries(
  sources.map(s => [s, wrapSource((rawSdk as any)[s])]),
)

/** Bound getListDetail for createPlaylistService. */
export function createSdkGetListDetail() {
  return (source: OnlineSource, id: string, page: number) =>
    sdk[source]!.songList.getListDetail(id, page)
}

export default sdk
