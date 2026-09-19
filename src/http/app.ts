import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { createRepos, DownloadRow, JobRow, PlaylistRow } from '../db/repos.js'
import { coverFromPlaylistUrl } from '../db/index.js'
import type { MusicInfo, OnlineSource } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'
import type { SyncProgress } from '../services/sync.js'
import {
  applyProxyFromSettings,
  createSettingsService,
} from '../services/settings.js'

type Repos = ReturnType<typeof createRepos>

export type AppCtx = {
  dataDir: string
  repos: Repos
  sync: {
    syncPlaylist(id: number): Promise<JobRow>
    syncAll(): Promise<JobRow>
    downloadSearch(musicInfo: MusicInfo): Promise<DownloadRow>
    getRunningProgress(): SyncProgress | null
  }
  playlists: {
    refreshPlaylistSnapshot(playlistId: number): Promise<PlaylistRow>
  }
  search: {
    searchMusic(
      source: OnlineSource | 'all',
      q: string,
      page: number,
    ): Promise<{ list: MusicInfo[]; total: number }>
  }
  runtime: {
    load(script: string): Promise<SourceStatus>
    getStatus(): SourceStatus
    setProxy(proxy: { host: string; port: number } | null): void
  }
  stream: {
    remember(musicInfo: MusicInfo): void
    open(songKey: string, rangeHeader: string | undefined): Promise<Response>
  }
  /** Called after schedule-related settings change so serve can reschedule cron. */
  rescheduleCron?: () => void
}

function parseEnabled(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  if (value === '1' || value === 'true') return 1
  if (value === '0' || value === 'false') return 0
  return undefined
}

function asMusicInfo(body: Record<string, unknown>): MusicInfo | null {
  if (body.musicInfo && typeof body.musicInfo === 'object') {
    return body.musicInfo as MusicInfo
  }
  const source = body.source
  const id = body.id
  if (typeof source === 'string' && (typeof id === 'string' || typeof id === 'number')) {
    const platformId = String(id)
    const songKey = platformId.includes('_') ? platformId : `${source}_${platformId}`
    return {
      id: songKey,
      name: platformId,
      singer: '',
      source: source as MusicInfo['source'],
      interval: null,
      meta: {},
    }
  }
  return null
}

type LyricDownloadOverlay = Pick<DownloadRow, 'name' | 'singer' | 'source' | 'pic_url'>

function lyricDisplayFields(musicInfo: MusicInfo, row?: LyricDownloadOverlay) {
  return {
    name: row?.name || musicInfo.name,
    singer: row?.singer || musicInfo.singer,
    source: row?.source || musicInfo.source,
    picUrl: row?.pic_url || String(musicInfo.meta?.picUrl || ''),
  }
}

async function lyricPayload(songKey: string, musicInfo: MusicInfo, row?: LyricDownloadOverlay) {
  const display = lyricDisplayFields(musicInfo, row)
  try {
    const { getLyricForMusic } = await import('../services/lyrics.js')
    const lyric = await getLyricForMusic(musicInfo)
    return {
      songKey,
      ...display,
      lyric: lyric.lyric || '',
      tlyric: lyric.tlyric || '',
    }
  } catch {
    return {
      songKey,
      ...display,
      lyric: '',
      tlyric: '',
    }
  }
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    /* empty */
  }
  return {}
}

export function createApp(ctx: AppCtx): Hono {
  const app = new Hono()
  const { repos, sync, search, runtime, dataDir, playlists } = ctx
  const settings = createSettingsService({
    repos,
    runtime,
    rescheduleCron: ctx.rescheduleCron,
  })

  app.get('/api/playlists', c => {
    const downloadKeys = new Set(repos.downloads.list().map(d => d.song_key))
    const list = repos.playlists.list().map(p => {
      const tracks = repos.tracks.list(p.id)
      let coverUrl = String(p.cover_url || '')
      if (!coverUrl) {
        for (const t of tracks) {
          try {
            const music = JSON.parse(t.raw || '{}') as MusicInfo
            const pic = String(music.meta?.picUrl || '')
            if (pic && pic !== 'null') {
              coverUrl = pic
              break
            }
          } catch {
            /* next */
          }
        }
      }
      if (!coverUrl) {
        coverUrl = coverFromPlaylistUrl(p.url)
      }
      return {
        ...p,
        trackCount: tracks.length,
        downloaded: tracks.filter(t => downloadKeys.has(t.song_key)).length,
        coverUrl,
      }
    })
    return c.json({ list })
  })

  app.post('/api/playlists', async c => {
    const body = await readJson(c)
    const source = body.source
    const url = body.url
    if (typeof source !== 'string' || !source || typeof url !== 'string' || !url) {
      return c.json({ error: 'source and url required' }, 400)
    }
    const row = repos.playlists.insert({ source: source as OnlineSource, url })
    return c.json(row)
  })

  app.post('/api/playlists/:id/refresh', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || !repos.playlists.get(id)) {
      return c.json({ error: 'not found' }, 404)
    }
    try {
      const row = await playlists.refreshPlaylistSnapshot(id)
      const tracks = repos.tracks.list(id)
      return c.json({ playlist: row, trackCount: tracks.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.patch('/api/playlists/:id', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'not found' }, 404)
    const existing = repos.playlists.get(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    const body = await readJson(c)
    const partial: { name?: string; enabled?: number } = {}
    if (typeof body.name === 'string') partial.name = body.name
    const enabled = parseEnabled(body.enabled)
    if (enabled !== undefined) partial.enabled = enabled
    const row = repos.playlists.patch(id, partial)
    return c.json(row)
  })

  app.delete('/api/playlists/:id', c => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || !repos.playlists.get(id)) {
      return c.json({ error: 'not found' }, 404)
    }
    repos.playlists.remove(id)
    return c.body(null, 204)
  })

  app.get('/api/playlists/:id/tracks', c => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || !repos.playlists.get(id)) {
      return c.json({ error: 'not found' }, 404)
    }
    const tracks = repos.tracks.list(id)
    const downloads = new Set(repos.downloads.list().map(d => d.song_key))
    return c.json({
      list: tracks.map(t => {
        let musicInfo: MusicInfo | null = null
        try {
          musicInfo = JSON.parse(t.raw || '{}') as MusicInfo
          if (!musicInfo?.id) musicInfo = null
        } catch {
          musicInfo = null
        }
        const picUrl = String(musicInfo?.meta?.picUrl || '')
        return {
          songKey: t.song_key,
          name: t.name,
          singer: t.singer,
          album: t.album,
          downloaded: downloads.has(t.song_key),
          musicInfo,
          picUrl,
        }
      }),
    })
  })

  app.post('/api/playlists/:id/sync', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || !repos.playlists.get(id)) {
      return c.json({ error: 'not found' }, 404)
    }
    const job = await sync.syncPlaylist(id)
    return c.json(job)
  })

  app.post('/api/sync', async c => {
    const job = await sync.syncAll()
    return c.json(job)
  })

  app.get('/api/jobs', c => {
    return c.json({
      list: repos.jobs.list(),
      running: sync.getRunningProgress(),
    })
  })

  app.get('/api/search', async c => {
    const q = c.req.query('q')
    if (!q) return c.json({ error: 'q required' }, 400)
    const source = (c.req.query('source') || 'all') as OnlineSource | 'all'
    const page = Math.max(1, Number(c.req.query('page') || '1') || 1)
    const result = await search.searchMusic(source, q, page)
    return c.json(result)
  })

  app.post('/api/downloads', async c => {
    const body = await readJson(c)
    const musicInfo = asMusicInfo(body)
    if (!musicInfo) return c.json({ error: 'musicInfo or source+id required' }, 400)
    try {
      const row = await sync.downloadSearch(musicInfo)
      return c.json(row)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/downloads', c => {
    return c.json({ list: repos.downloads.list() })
  })

  app.post('/api/stream', async c => {
    const body = await readJson(c)
    const musicInfo = asMusicInfo(body)
    if (!musicInfo) return c.json({ error: 'musicInfo or source+id required' }, 400)
    ctx.stream.remember(musicInfo)
    return c.json({ songKey: musicInfo.id })
  })

  app.get('/api/stream', async c => {
    const songKey = c.req.query('songKey')
    if (!songKey) return c.json({ error: 'songKey required' }, 400)
    return ctx.stream.open(songKey, c.req.header('Range'))
  })

  app.post('/api/downloads/backfill-covers', async c => {
    const { ensureMusicPic } = await import('../services/pic.js')
    const rows = repos.downloads.list().filter(r => !r.pic_url)
    let updated = 0
    for (const row of rows) {
      let musicInfo: MusicInfo | null = null
      try {
        musicInfo = JSON.parse(row.raw || '{}') as MusicInfo
      } catch {
        musicInfo = null
      }
      if (!musicInfo?.id) {
        musicInfo = {
          id: row.song_key,
          name: row.name || row.song_key,
          singer: row.singer || '',
          source: (row.source || 'wy') as MusicInfo['source'],
          interval: null,
          meta: {},
        }
      }
      try {
        const enriched = await ensureMusicPic(musicInfo)
        const picUrl = String(enriched.meta?.picUrl || '')
        if (!picUrl) continue
        repos.downloads.upsert({
          ...row,
          name: row.name || enriched.name,
          singer: row.singer || enriched.singer,
          source: row.source || String(enriched.source),
          pic_url: picUrl,
          raw: JSON.stringify(enriched),
        })
        updated++
      } catch {
        /* skip one */
      }
    }
    return c.json({ updated, scanned: rows.length })
  })

  app.get('/api/lyrics', async c => {
    const songKey = c.req.query('songKey')
    if (!songKey) return c.json({ error: 'songKey required' }, 400)
    const row = repos.downloads.get(songKey)
    if (!row) return c.json({ error: 'not found' }, 404)
    let musicInfo: MusicInfo | null = null
    try {
      musicInfo = JSON.parse(row.raw || '{}') as MusicInfo
    } catch {
      musicInfo = null
    }
    if (!musicInfo?.id) {
      musicInfo = {
        id: row.song_key,
        name: row.name || row.song_key,
        singer: row.singer || '',
        source: (row.source || 'wy') as MusicInfo['source'],
        interval: null,
        meta: { picUrl: row.pic_url },
      }
    }
    return c.json(await lyricPayload(songKey, musicInfo, row))
  })

  app.post('/api/lyrics', async c => {
    const body = await readJson(c)
    let musicInfo = asMusicInfo(body)
    const songKey = typeof body.songKey === 'string' ? body.songKey : musicInfo?.id
    if (!musicInfo && typeof body.songKey === 'string') {
      const row = repos.downloads.get(body.songKey)
      const track = repos.tracks.findBySongKey(body.songKey)
      const raw = row?.raw || track?.raw || '{}'
      try {
        musicInfo = JSON.parse(raw) as MusicInfo
      } catch {
        musicInfo = null
      }
    }
    if (!musicInfo?.id || !songKey) return c.json({ error: 'musicInfo or songKey required' }, 400)
    return c.json(await lyricPayload(songKey, musicInfo))
  })

  app.get('/api/source/status', c => {
    return c.json(runtime.getStatus())
  })

  app.get('/api/settings', c => {
    return c.json(settings.get())
  })

  app.put('/api/settings', async c => {
    const body = await readJson(c)
    return c.json(settings.put(body))
  })

  app.post('/api/settings/user-api', async c => {
    const body = await c.req.parseBody()
    const file = body.file
    if (!file || typeof file === 'string') {
      return c.json({ error: 'file required' }, 400)
    }
    const script = await (file as File).text()
    const dir = join(dataDir, 'user-api')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'current.js'), script, 'utf8')
    const status = await runtime.load(script)
    applyProxyFromSettings(repos, runtime)
    return c.json(status)
  })

  app.post('/api/settings/user-api/url', async c => {
    const body = await readJson(c)
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
    if (!rawUrl) {
      return c.json({ error: 'url required' }, 400)
    }
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return c.json({ error: 'invalid url' }, 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return c.json({ error: 'only http(s) urls are allowed' }, 400)
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(parsed.toString(), {
          signal: controller.signal,
          redirect: 'follow',
          headers: { Accept: 'text/plain, application/javascript, */*' },
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        return c.json({ error: `download failed: ${res.status}` }, 400)
      }
      const script = await res.text()
      if (!script.trim()) {
        return c.json({ error: 'empty script' }, 400)
      }
      const dir = join(dataDir, 'user-api')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'current.js'), script, 'utf8')
      const status = await runtime.load(script)
      applyProxyFromSettings(repos, runtime)
      return c.json(status)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 400)
    }
  })

  return app
}

export type { PlaylistRow }
