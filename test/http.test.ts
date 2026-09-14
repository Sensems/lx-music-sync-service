import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'
import { createRepos, type DownloadRow, type JobRow } from '../src/db/repos.js'
import type { AppCtx } from '../src/http/app.js'
import type { MusicInfo } from '../src/types.js'
import type { SourceStatus } from '../src/userApi/runtime.js'

function makeTestCtx(): AppCtx {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-http-'))
  const db = openDb(join(dataDir, 't.db'))
  const repos = createRepos(db)

  let status: SourceStatus = {
    ok: true,
    message: '',
    name: 'test-source',
    version: '1.0.0',
    sources: { wy: { actions: ['musicUrl'], qualitys: ['128k', '320k'] } },
  }
  const loaded: string[] = []
  const proxyUpdates: Array<{ host: string; port: number } | null> = []

  const fakeJob = (partial: Partial<JobRow> = {}): JobRow => ({
    id: 1,
    kind: 'playlist',
    playlist_id: 1,
    status: 'success',
    started_at: Date.now(),
    finished_at: Date.now(),
    scanned: 0,
    skipped: 0,
    downloaded: 0,
    failed: 0,
    error_summary: null,
    ...partial,
  })

  return {
    dataDir,
    repos,
    sync: {
      async syncPlaylist(id: number) {
        return fakeJob({ kind: 'playlist', playlist_id: id, id: 11 })
      },
      async syncAll() {
        return fakeJob({ kind: 'all', playlist_id: null, id: 12 })
      },
      async downloadSearch(musicInfo: MusicInfo): Promise<DownloadRow> {
        const row: DownloadRow = {
          song_key: musicInfo.id,
          file_path: join(dataDir, 'music', 'search', `${musicInfo.id}.mp3`),
          quality: '320k',
          playlist_id: null,
          source_kind: 'search',
          completed_at: Date.now(),
        }
        repos.downloads.upsert(row)
        return row
      },
      getRunningProgress() {
        return null
      },
    },
    search: {
      async searchMusic(_source, q, _page) {
        return {
          list: [
            {
              id: 'wy_1',
              name: q,
              singer: 'Artist',
              source: 'wy',
              interval: null,
              meta: {},
            },
          ],
          total: 1,
        }
      },
    },
    runtime: {
      async load(script: string) {
        loaded.push(script)
        status = {
          ok: true,
          message: '',
          name: 'uploaded',
          version: '2.0.0',
          sources: { wy: { actions: ['musicUrl'], qualitys: ['320k'] } },
        }
        return status
      },
      getStatus() {
        return status
      },
      setProxy(proxy) {
        proxyUpdates.push(proxy)
      },
    },
    _test: { loaded, proxyUpdates },
  } as AppCtx & { _test: { loaded: string[]; proxyUpdates: Array<{ host: string; port: number } | null> } }
}

describe('POST /api/playlists', () => {
  it('requires source and url', async () => {
    const { createApp: create } = await import('../src/http/app.js')
    const app = create(makeTestCtx())
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'wy' }),
    })
    expect(res.status).toBe(400)
  })

  it('creates playlist when source and url present', async () => {
    const { createApp: create } = await import('../src/http/app.js')
    const ctx = makeTestCtx()
    const app = create(ctx)
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'wy', url: 'https://music.163.com/playlist?id=1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('wy')
    expect(body.url).toContain('playlist')
    expect(body.id).toBeTypeOf('number')
  })
})

describe('playlist CRUD and sync', () => {
  it('lists, patches, syncs, deletes without removing download files', async () => {
    const { createApp: create } = await import('../src/http/app.js')
    const ctx = makeTestCtx()
    const app = create(ctx)

    const created = await (
      await app.request('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'kw', url: '42' }),
      })
    ).json()

    const listRes = await app.request('/api/playlists')
    expect(listRes.status).toBe(200)
    expect((await listRes.json()).list).toHaveLength(1)

    const patchRes = await app.request(`/api/playlists/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '本地名', enabled: false }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json()
    expect(patched.name).toBe('本地名')
    expect(patched.enabled).toBe(0)

    const missing = await app.request('/api/playlists/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(missing.status).toBe(404)

    const syncOne = await app.request(`/api/playlists/${created.id}/sync`, { method: 'POST' })
    expect(syncOne.status).toBe(200)
    expect((await syncOne.json()).kind).toBe('playlist')

    const syncAll = await app.request('/api/sync', { method: 'POST' })
    expect(syncAll.status).toBe(200)
    expect((await syncAll.json()).kind).toBe('all')

    ctx.repos.downloads.upsert({
      song_key: 'kw_1',
      file_path: '/tmp/keep.mp3',
      quality: '320k',
      playlist_id: created.id,
      source_kind: 'playlist',
      completed_at: Date.now(),
    })

    const del = await app.request(`/api/playlists/${created.id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect(ctx.repos.downloads.get('kw_1')?.file_path).toBe('/tmp/keep.mp3')
  })
})

describe('search jobs downloads settings', () => {
  it('validates search q and returns jobs/downloads/settings/status', async () => {
    const { createApp: create } = await import('../src/http/app.js')
    const ctx = makeTestCtx()
    const app = create(ctx)

    const badSearch = await app.request('/api/search?source=wy')
    expect(badSearch.status).toBe(400)

    const search = await app.request('/api/search?source=all&q=%E8%B5%B7%E9%A3%8E%E4%BA%86')
    expect(search.status).toBe(200)
    const searchBody = await search.json()
    expect(searchBody.list[0].name).toContain('起风了')

    const dl = await app.request('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        musicInfo: {
          id: 'wy_9',
          name: 'Song',
          singer: 'S',
          source: 'wy',
          interval: null,
          meta: {},
        },
      }),
    })
    expect(dl.status).toBe(200)
    expect((await dl.json()).song_key).toBe('wy_9')

    const dlList = await app.request('/api/downloads')
    expect(dlList.status).toBe(200)
    expect((await dlList.json()).list.some((r: DownloadRow) => r.song_key === 'wy_9')).toBe(true)

    const jobs = await app.request('/api/jobs')
    expect(jobs.status).toBe(200)
    const jobsBody = await jobs.json()
    expect(jobsBody).toHaveProperty('list')
    expect(jobsBody).toHaveProperty('running')

    const status = await app.request('/api/source/status')
    expect(status.status).toBe(200)
    expect((await status.json()).name).toBe('test-source')

    const settings = await app.request('/api/settings')
    expect(settings.status).toBe(200)
    const settingsBody = await settings.json()
    expect(settingsBody.name).toBe('test-source')
    expect(settingsBody.version).toBe('1.0.0')

    const put = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxyOn: '1', proxyHost: '127.0.0.1', proxyPort: '7890', quality: 'flac' }),
    })
    expect(put.status).toBe(200)
    expect(ctx.repos.settings.getAll().quality).toBe('flac')
    expect((ctx as any)._test.proxyUpdates.at(-1)).toEqual({ host: '127.0.0.1', port: 7890 })

    const form = new FormData()
    form.append('file', new File(['/** @name u @description d @version 2.0.0 @author a */\n'], 'api.js'))
    const upload = await app.request('/api/settings/user-api', { method: 'POST', body: form })
    expect(upload.status).toBe(200)
    expect((ctx as any)._test.loaded.length).toBe(1)
    expect((await upload.json()).name).toBe('uploaded')
  })
})

describe('loadConfig', () => {
  it('defaults host port dataDir logLevel', async () => {
    const { loadConfig } = await import('../src/config.js')
    const cfg = loadConfig({ configPath: join(tmpdir(), 'missing-tinggui-config.yaml') })
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(8787)
    expect(cfg.dataDir).toBe('./data')
    expect(cfg.logLevel).toBe('info')
  })
})
