export type JobSnapshot = {
  status: string
  result: Record<string, unknown> | null
  error_summary: string | null
}

async function readJson(r: Response, fallback: string) {
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || fallback)
  return body
}

export const api = {
  subscriptions: () =>
    fetch('/api/subscriptions').then(r => readJson(r, '加载歌单失败')),
  subscriptionTracks: (id: string) =>
    fetch(`/api/subscriptions/${encodeURIComponent(id)}/tracks`).then(r => readJson(r, '加载曲目失败')),
  addSubscription: (body: { platform: string; sourceUrl: string }) =>
    fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => readJson(r, '添加失败') as Promise<{ playlistId: string }>),
  refreshSubscription: (id: string) =>
    fetch(`/api/subscriptions/${encodeURIComponent(id)}/refresh`, { method: 'POST' }).then(
      r => readJson(r, '拉取曲目失败') as Promise<{ jobId: string }>,
    ),
  cachePlaylist: (id: string) =>
    fetch(`/api/cache/playlists/${encodeURIComponent(id)}`, { method: 'POST' }).then(
      r => readJson(r, '缓存失败') as Promise<{ jobId: string }>,
    ),
  cachedSongs: () => fetch('/api/library/cached').then(r => readJson(r, '加载唱片墙失败')),
  streamUrl: (songId: string) => `/api/library/songs/${encodeURIComponent(songId)}/stream`,
  jobs: () => fetch('/api/jobs', { cache: 'no-store' }).then(r => r.json()),
  search: (source: string, q: string) =>
    fetch(`/api/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`).then(r =>
      r.json(),
    ),
  addLibraryTrack: (musicInfo: object) =>
    fetch('/api/library/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(musicInfo),
    }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '入库失败')
      return body as { songId: string }
    }),
  cacheSong: (songId: string) =>
    fetch(`/api/cache/songs/${encodeURIComponent(songId)}`, { method: 'POST' }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '下载失败')
      return body as { jobId: string }
    }),
  libraryRoots: () =>
    fetch('/api/library/roots').then(
      r => readJson(r, '加载目录失败') as Promise<{ list: { id: string; path: string }[] }>,
    ),
  addLibraryRoot: (path: string) =>
    fetch('/api/library/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(r => readJson(r, '添加目录失败') as Promise<{ id: string; path: string }>),
  removeLibraryRoot: async (id: string) => {
    const r = await fetch(`/api/library/roots/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (r.status === 204) return
    let detail = '去掉目录失败'
    try {
      const body = await r.json()
      if (typeof body?.error === 'string' && body.error) detail = body.error
    } catch {
      // 空响应也按失败处理。
    }
    throw new Error(detail)
  },
  scanLibrary: () =>
    fetch('/api/library/scan', { method: 'POST' }).then(
      r => readJson(r, '扫描失败') as Promise<{ jobId: string }>,
    ),
  removeLibrarySong: async (songId: string) => {
    const r = await fetch(`/api/library/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' })
    if (r.status === 204) return
    let detail = '去掉这首歌失败'
    try {
      const body = await r.json()
      if (typeof body?.error === 'string' && body.error) detail = body.error
    } catch {
      // 空响应也按失败处理。
    }
    throw new Error(detail)
  },
  tidyLibrary: () =>
    fetch('/api/library/tidy', { method: 'POST' }).then(
      r => readJson(r, '整理失败') as Promise<{
        removedSongs: number
        clearedFiles: number
        trimmedJobs: number
        trimmedScrobbles: number
      }>,
    ),
  job: (id: string) =>
    fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' }).then(
      r => readJson(r, '任务查询失败') as Promise<JobSnapshot>,
    ),
  lyricsFor: (input: { songKey?: string; musicInfo?: unknown }) =>
    fetch('/api/lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.musicInfo ? { musicInfo: input.musicInfo } : { songKey: input.songKey }),
    }).then(async r => {
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || '歌词获取失败')
      return body as { lyric: string; tlyric?: string; picUrl?: string }
    }),
  settings: () => fetch('/api/settings').then(r => r.json()),
  putSettings: (body: object) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => readJson(r, '保存失败')),
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

/** 缓存和刷新都是排队任务。调用方决定要不要中途停下轮询。 */
export async function waitJob(jobId: string, shouldStop?: () => boolean): Promise<JobSnapshot | null> {
  for (;;) {
    const job = await api.job(jobId)
    if (job.status === 'success' || job.status === 'failed') return job
    if (shouldStop?.()) return null
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}
