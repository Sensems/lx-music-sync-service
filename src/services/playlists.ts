import type { OnlineSource } from '../types.js'

export type ListDetailPage = {
  list: unknown[]
  page: number
  limit: number
  total: number
  source: string
  info: { name: string; img?: string; desc?: string; author?: string }
}

/** 在线歌单分页。订阅刷新把整份歌单拉完再替换成员。 */
export type GetListDetail = (
  source: OnlineSource,
  id: string,
  page: number,
) => Promise<ListDetailPage>
