import type { MusicInfo, OnlineSource } from '../types.js'

export type MusicSearchResult = {
  list: MusicInfo[]
  total: number
  allPage?: number
  limit?: number
  source?: string
}

export type SearchSdk = Record<
  string,
  {
    musicSearch: {
      search: (q: string, page: number, limit: number) => Promise<MusicSearchResult>
    }
  }
>

const ONLINE_SOURCES: OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']

export function createSearchService(sdk: SearchSdk) {
  return {
    async searchMusic(
      source: OnlineSource | 'all',
      q: string,
      page: number,
    ): Promise<{ list: MusicInfo[]; total: number }> {
      if (source !== 'all') {
        const mod = sdk[source]
        if (!mod?.musicSearch?.search) {
          return { list: [], total: 0 }
        }
        try {
          const res = await mod.musicSearch.search(q, page, 30)
          return { list: res.list ?? [], total: res.total ?? (res.list?.length ?? 0) }
        } catch {
          return { list: [], total: 0 }
        }
      }

      const keys = ONLINE_SOURCES.filter(s => sdk[s]?.musicSearch?.search) 
      const extra = Object.keys(sdk).filter(
        s => !ONLINE_SOURCES.includes(s as OnlineSource) && sdk[s]?.musicSearch?.search,
      )
      const sources = [...keys, ...extra]

      const results = await Promise.all(
        sources.map(async s => {
          try {
            return await sdk[s]!.musicSearch.search(q, page, 30)
          } catch {
            return { list: [] as MusicInfo[], total: 0 }
          }
        }),
      )

      const seen = new Set<string>()
      const list: MusicInfo[] = []
      for (const res of results) {
        for (const item of res.list ?? []) {
          if (!item?.id || seen.has(item.id)) continue
          seen.add(item.id)
          list.push(item)
        }
      }
      return { list, total: list.length }
    },
  }
}
