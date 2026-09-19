export type SourceId = 'wy' | 'tx' | 'kg' | 'kw' | 'mg'

export interface Playlist {
  id: string
  source: SourceId
  url: string
  name: string
  enabled: boolean
  trackCount: number
  downloaded: number
  spine: string
  coverUrl?: string
}

export interface Track {
  songKey: string
  name: string
  singer: string
  album: string
  downloaded: boolean
  musicInfo?: {
    id: string
    name: string
    singer: string
    source: string
    interval: number | null
    meta: Record<string, unknown>
  } | null
  picUrl?: string
}

export interface SearchHit {
  songKey: string
  name: string
  singer: string
  source: SourceId
  interval?: number | null
  meta?: Record<string, unknown>
}

export interface JobLine {
  id: string
  title: string
  detail: string
  kind: 'run' | 'skip' | 'done' | 'fail'
}

export const sourceLabels: Record<SourceId, string> = {
  wy: '网易',
  tx: 'QQ',
  kg: '酷狗',
  kw: '酷我',
  mg: '咪咕',
}

export const playlists: Playlist[] = [
  { id: '1', source: 'wy', url: 'https://music.163.com/playlist?id=1', name: '深夜通勤', enabled: true, trackCount: 42, downloaded: 40, spine: '#6B2D3C' },
  { id: '2', source: 'tx', url: 'https://y.qq.com/n/ryqq/playlist/2', name: '旧磁带', enabled: true, trackCount: 18, downloaded: 18, spine: '#3D4A2A' },
  { id: '3', source: 'kg', url: 'https://www.kugou.com/yy/special/index/3.html', name: '没写完的夏天', enabled: false, trackCount: 27, downloaded: 12, spine: '#2A3A4A' },
  { id: '4', source: 'kw', url: 'https://www.kuwo.cn/playlist_detail/4', name: '收音机备忘', enabled: true, trackCount: 9, downloaded: 8, spine: '#5A3D1E' },
]

export const tracksByPlaylist: Record<string, Track[]> = {
  '1': [
    { songKey: 'wy_188111', name: '夜空中最亮的星', singer: '逃跑计划', album: '世界', downloaded: true },
    { songKey: 'wy_297322', name: '理想三旬', singer: '陈鸿宇', album: '一如年少模样', downloaded: true },
    { songKey: 'wy_447925', name: '起风了', singer: '买辣椒也用券', album: '起风了', downloaded: false },
  ],
  '2': [
    { songKey: 'tx_001', name: '晴天', singer: '周杰伦', album: '叶惠美', downloaded: true },
  ],
  '3': [
    { songKey: 'kg_88', name: '南方姑娘', singer: '赵雷', album: '吉姆餐厅', downloaded: false },
  ],
  '4': [
    { songKey: 'kw_9', name: '平凡之路', singer: '朴树', album: '猎户星座', downloaded: true },
  ],
}

export const searchHits: SearchHit[] = [
  { songKey: 'wy_447925', name: '起风了', singer: '买辣椒也用券', source: 'wy' },
  { songKey: 'tx_003', name: '起风了', singer: '吴青峰', source: 'tx' },
]

export const jobLines: JobLine[] = [
  { id: 'j1', title: '同步中 · 深夜通勤', detail: '起风了 — 买辣椒也用券  12.4 / 18.1 MB', kind: 'run' },
  { id: 'j2', title: '跳过', detail: '理想三旬 已在本地 wy_297322', kind: 'skip' },
  { id: 'j3', title: '完成', detail: '夜空中最亮的星 写入 深夜通勤/', kind: 'done' },
  { id: 'j4', title: '失败', detail: '南方姑娘 音源未返回地址，下一轮再试', kind: 'fail' },
]
