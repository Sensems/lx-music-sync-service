export type PlayItem = {
  songKey: string
  name: string
  singer: string
  picUrl: string
  source: string
  musicInfo: {
    id: string
    name: string
    singer: string
    source: string
    interval: number | null
    meta: Record<string, unknown>
  } | null
}

export type LoopMode = 'off' | 'one' | 'all'

export type QueueState = {
  items: PlayItem[]
  index: number
}

export type LyricLine = { time: number; text: string }
