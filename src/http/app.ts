import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { createRepos, DownloadRow, JobRow, PlaylistRow } from '../db/repos.js'
import { proxyFromSettings } from '../sdk/proxy.js'
import type { MusicInfo, OnlineSource } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'
import type { SyncProgress } from '../services/sync.js'

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
}

const SETTINGS_WRITABLE = new Set([
  'savePath',
  'quality',
  'scheduleOn',
  'schedule',
  'cron',
  'concurrency',
  'fileName',
  'proxyOn',
  'proxyHost',
  'proxyPort',
])

function settingsWithSource(repos: Repos, runtime: AppCtx['runtime']) {
  const settings = repos.settings.getAll()
  const status = runtime.getStatus()
  return {
    ...settings,
    name: status.name ?? '',
    version: status.version ?? '',
    sourceOk: status.ok,
    sourceMessage: status.message,
  }
}

function applyProxyFromSettings(repos: Repos, runtime: AppCtx['runtime']) {
  runtime.setProxy(proxyFromSettings(repos.settings.getAll()))
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
  const { repos, sync, search, runtime, dataDir } = ctx

  app.get('/api/playlists', c => {
    return c.json({ list: repos.playlists.list() })
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

  app.get('/api/source/status', c => {
    return c.json(runtime.getStatus())
  })

  app.get('/api/settings', c => {
    return c.json(settingsWithSource(repos, runtime))
  })

  app.put('/api/settings', async c => {
    const body = await readJson(c)
    const partial: Record<string, string> = {}
    for (const [key, value] of Object.entries(body)) {
      if (!SETTINGS_WRITABLE.has(key)) continue
      if (value === undefined || value === null) continue
      partial[key] = String(value)
    }
    if (Object.keys(partial).length) {
      repos.settings.setMany(partial)
    }
    if (
      'proxyOn' in partial ||
      'proxyHost' in partial ||
      'proxyPort' in partial
    ) {
      applyProxyFromSettings(repos, runtime)
    }
    return c.json(settingsWithSource(repos, runtime))
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

  return app
}

export type { PlaylistRow }
