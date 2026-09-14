export const api = {
  playlists: () => fetch('/api/playlists').then(r => r.json()),
  tracks: (id: number) => fetch(`/api/playlists/${id}/tracks`).then(r => r.json()),
  addPlaylist: (body: { source: string; url: string }) =>
    fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),
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
    }).then(r => r.json()),
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
  sourceStatus: () => fetch('/api/source/status').then(r => r.json()),
}
