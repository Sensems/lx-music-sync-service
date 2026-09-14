export const api = {
  playlists: () => fetch('/api/playlists').then(r => r.json()),
  tracks: (id: number) => fetch(`/api/playlists/${id}/tracks`).then(r => r.json()),
  addPlaylist: (body: { source: string; url: string }) =>
    fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '添加失败')
      return body
    }),
  refreshPlaylist: (id: number) =>
    fetch(`/api/playlists/${id}/refresh`, { method: 'POST' }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '拉取曲目失败')
      return body
    }),
  patchPlaylist: (id: number, body: object) =>
    fetch(`/api/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),
  syncPlaylist: (id: number) =>
    fetch(`/api/playlists/${id}/sync`, { method: 'POST' }).then(r => r.json()),
  syncAll: () => fetch('/api/sync', { method: 'POST' }).then(r => r.json()),
  jobs: () => fetch('/api/jobs').then(r => r.json()),
  search: (source: string, q: string) =>
    fetch(`/api/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`).then(r =>
      r.json(),
    ),
  download: (musicInfo: unknown) =>
    fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicInfo }),
    }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '下载失败')
      return body
    }),
  downloads: () => fetch('/api/downloads').then(r => r.json()),
  backfillCovers: () =>
    fetch('/api/downloads/backfill-covers', { method: 'POST' }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '补封面失败')
      return body
    }),
  lyrics: (songKey: string) =>
    fetch(`/api/lyrics?songKey=${encodeURIComponent(songKey)}`).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '歌词获取失败')
      return body
    }),
  settings: () => fetch('/api/settings').then(r => r.json()),
  putSettings: (body: object) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),
  uploadUserApi: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch('/api/settings/user-api', { method: 'POST', body: fd }).then(r => r.json())
  },
  importUserApiUrl: (url: string) =>
    fetch('/api/settings/user-api/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || 'import failed')
      return body
    }),
  sourceStatus: () => fetch('/api/source/status').then(r => r.json()),
}
