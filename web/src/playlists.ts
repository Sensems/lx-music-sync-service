import type { Playlist, SourceId } from './mock/data'

const SPINES = ['#6B2D3C', '#3D4A2A', '#2A3A4A', '#5A3D1E', '#4A1F2A', '#3A2A4A']

export function spineFor(id: string | number): string {
  const n = typeof id === 'number' ? id : Number(id) || 0
  return SPINES[Math.abs(n) % SPINES.length]
}

export function mapPlaylist(row: Record<string, unknown>): Playlist {
  const id = String(row.id)
  const cover = String(row.cover_url || row.coverUrl || '')
  return {
    id,
    source: (row.platform || row.source) as SourceId,
    url: String(row.source_url || row.url || ''),
    name: String(row.name || '未命名歌单'),
    enabled: true,
    trackCount: Number(row.track_count ?? row.trackCount ?? 0),
    downloaded: Number(row.cached_count ?? row.downloaded ?? 0),
    spine: spineFor(id),
    coverUrl: cover && cover !== 'null' ? cover : undefined,
  }
}

export function mapTrack(row: Record<string, unknown>) {
  const music =
    row.musicInfo && typeof row.musicInfo === 'object' && !Array.isArray(row.musicInfo)
      ? (row.musicInfo as {
          id: string
          name: string
          singer: string
          source: string
          interval: number | null
          meta: Record<string, unknown>
        })
      : null
  const songId = String(row.songId ?? '')
  return {
    songKey: music?.id || songId,
    songId,
    name: String(row.name ?? ''),
    singer: String(row.singer ?? ''),
    album: String(row.album ?? ''),
    downloaded: row.downloaded === true,
    picUrl: String(row.picUrl || ''),
    source: String(row.source || music?.source || ''),
    quality: String(row.quality || ''),
    musicInfo: music,
  }
}
