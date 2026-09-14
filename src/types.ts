export type Quality = 'flac24bit' | 'flac' | 'wav' | 'ape' | '320k' | '192k' | '128k'

export type OnlineSource = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'

export type MusicInfo = {
  id: string
  name: string
  singer: string
  source: OnlineSource | 'local'
  interval: number | null | undefined
  meta: Record<string, unknown>
}
