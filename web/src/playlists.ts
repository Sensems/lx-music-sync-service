import type { Playlist, SourceId } from './mock/data'

const SPINES = ['#6B2D3C', '#3D4A2A', '#2A3A4A', '#5A3D1E', '#4A1F2A', '#3A2A4A']

export function spineFor(id: string | number): string {
  const n = typeof id === 'number' ? id : Number(id) || 0
  return SPINES[Math.abs(n) % SPINES.length]
}

export function mapPlaylist(row: Record<string, unknown>): Playlist {
  const id = String(row.id)
  return {
    id,
    source: row.source as SourceId,
    url: String(row.url ?? ''),
    name: String(row.name || '未命名歌单'),
    enabled: row.enabled === 1 || row.enabled === true,
    trackCount: Number(row.trackCount ?? 0),
    downloaded: Number(row.downloaded ?? 0),
    spine: spineFor(row.id as number),
    coverUrl: String(row.coverUrl || '') || undefined,
  }
}
