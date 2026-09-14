import type { createRepos, PlaylistRow, TrackRow } from '../db/repos.js'
import { safeDirName } from '../lib/names.js'
import { toNewMusicInfo } from '../lib/toNewMusicInfo.js'
import type { OnlineSource } from '../types.js'

export type ListDetailPage = {
  list: any[]
  page: number
  limit: number
  total: number
  source: string
  info: { name: string; img?: string; desc?: string; author?: string }
}

export type GetListDetail = (
  source: OnlineSource,
  id: string,
  page: number,
) => Promise<ListDetailPage>

type Repos = ReturnType<typeof createRepos>

async function fetchAllTracks(
  source: OnlineSource,
  id: string,
  getListDetail: GetListDetail,
): Promise<{ tracks: any[]; info: ListDetailPage['info'] }> {
  const first = await getListDetail(source, id, 1)
  const all = [...(first.list ?? [])]
  const limit = first.limit || 30
  const total = first.total ?? all.length
  const pages = Math.max(1, Math.ceil(total / limit))
  for (let page = 2; page <= pages; page++) {
    const next = await getListDetail(source, id, page)
    all.push(...(next.list ?? []))
  }
  return { tracks: all, info: first.info ?? { name: '' } }
}

function toTrackRow(playlistId: number, old: any): TrackRow {
  const music = toNewMusicInfo(old)
  const album = String(music.meta.albumName ?? '')
  const qualitys = music.meta.qualitys ?? []
  return {
    playlist_id: playlistId,
    song_key: music.id,
    name: music.name,
    singer: music.singer,
    album,
    qualitys: JSON.stringify(qualitys),
    raw: JSON.stringify(music),
  }
}

export function createPlaylistService(repos: Repos, deps: { getListDetail: GetListDetail }) {
  return {
    async refreshPlaylistSnapshot(playlistId: number): Promise<PlaylistRow> {
      const playlist = repos.playlists.get(playlistId)
      if (!playlist) {
        throw new Error(`playlist not found: ${playlistId}`)
      }

      const { tracks, info } = await fetchAllTracks(
        playlist.source,
        playlist.url,
        deps.getListDetail,
      )
      const onlineTitle = info?.name ?? ''

      repos.tracks.replaceAll(
        playlistId,
        tracks.map(t => toTrackRow(playlistId, t)),
      )

      const patch: { name?: string; save_dir?: string } = {}
      if (playlist.name_custom === 0 && onlineTitle) {
        patch.name = onlineTitle
      }
      if (!playlist.save_dir && onlineTitle) {
        patch.save_dir = safeDirName(onlineTitle)
      }

      if (patch.name !== undefined || patch.save_dir !== undefined) {
        return repos.playlists.updateAfterRefresh(playlistId, patch)
      }
      return repos.playlists.get(playlistId)!
    },
  }
}
