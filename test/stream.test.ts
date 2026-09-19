import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'
import { createRepos } from '../src/db/repos.js'
import { createApp, type AppCtx } from '../src/http/app.js'
import type { MusicInfo } from '../src/types.js'
import { createStreamService } from '../src/services/stream.js'

function music(partial: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: 'wy_s1',
    name: '歌',
    singer: '人',
    source: 'wy',
    interval: null,
    meta: {},
    ...partial,
  }
}

describe('stream service', () => {
  it('serves local file with Range', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-st-'))
    const db = openDb(join(dir, 't.db'))
    const repos = createRepos(db)
    mkdirSync(join(dir, 'music'), { recursive: true })
    const filePath = join(dir, 'music', 'a.bin')
    const bytes = Buffer.from('ABCDEFGHIJ')
    writeFileSync(filePath, bytes)
    repos.downloads.upsert({
      song_key: 'wy_s1',
      file_path: filePath,
      quality: '128k',
      playlist_id: null,
      source_kind: 'search',
      completed_at: Date.now(),
      name: '歌',
      singer: '人',
      source: 'wy',
      pic_url: '',
      raw: JSON.stringify(music()),
    })
    const stream = createStreamService({
      repos,
      async getMusicUrl() {
        throw new Error('should not hit url')
      },
      getWantedQuality: () => '128k',
    })
    const res = await stream.open('wy_s1', 'bytes=2-5')
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('CDEF')
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10')
  })

  it('falls back to getMusicUrl when file missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-st-'))
    const db = openDb(join(dir, 't.db'))
    const repos = createRepos(db)
    const info = music()
    const stream = createStreamService({
      repos,
      async getMusicUrl() {
        return { type: '128k', url: 'https://cdn.example/a.mp3' }
      },
      getWantedQuality: () => '128k',
      async fetchRemote(url, headers) {
        expect(url).toBe('https://cdn.example/a.mp3')
        expect(headers.Range || '').toMatch(/^bytes=/)
        return {
          status: 206,
          headers: new Headers({
            'Content-Type': 'audio/mpeg',
            'Content-Range': 'bytes 0-3/4',
            'Content-Length': '4',
          }),
          body: new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1, 2, 3, 4]))
              c.close()
            },
          }),
        }
      },
    })
    stream.remember(info)
    const res = await stream.open('wy_s1', 'bytes=0-3')
    expect(res.status).toBe(206)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect([...buf]).toEqual([1, 2, 3, 4])
  })

  it('rejects non-http music url', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-st-'))
    const repos = createRepos(openDb(join(dir, 't.db')))
    const stream = createStreamService({
      repos,
      async getMusicUrl() {
        return { type: '128k', url: 'file:///etc/passwd' }
      },
      getWantedQuality: () => '128k',
    })
    stream.remember(music())
    const res = await stream.open('wy_s1', undefined)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = await res.json()
    expect(body.error).toBe('暂时没有可播放的地址')
  })
})

describe('POST/GET /api/stream', () => {
  it('remembers musicInfo then opens via injected stream', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tg-st-http-'))
    const db = openDb(join(dataDir, 't.db'))
    const repos = createRepos(db)
    const remembered: MusicInfo[] = []
    const opened: Array<{ songKey: string; range: string | undefined }> = []
    const stream = {
      remember(musicInfo: MusicInfo) {
        remembered.push(musicInfo)
      },
      async open(songKey: string, rangeHeader: string | undefined) {
        opened.push({ songKey, range: rangeHeader })
        return new Response('stream-ok', {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      },
    }
    const ctx = {
      dataDir,
      repos,
      sync: {
        async syncPlaylist() {
          throw new Error('unused')
        },
        async syncAll() {
          throw new Error('unused')
        },
        async downloadSearch() {
          throw new Error('unused')
        },
        getRunningProgress() {
          return null
        },
      },
      playlists: {
        async refreshPlaylistSnapshot() {
          throw new Error('unused')
        },
      },
      search: {
        async searchMusic() {
          return { list: [], total: 0 }
        },
      },
      runtime: {
        async load() {
          throw new Error('unused')
        },
        getStatus() {
          return { ok: false, message: '', name: '', version: '', sources: {} }
        },
        setProxy() {},
      },
      stream,
    } as AppCtx

    const app = createApp(ctx)
    const info = music()
    const post = await app.request('/api/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicInfo: info }),
    })
    expect(post.status).toBe(200)
    expect(await post.json()).toEqual({ songKey: 'wy_s1' })
    expect(remembered).toHaveLength(1)
    expect(remembered[0]!.id).toBe('wy_s1')

    const get = await app.request('/api/stream?songKey=wy_s1', {
      headers: { Range: 'bytes=0-1' },
    })
    expect(get.status).toBe(200)
    expect(await get.text()).toBe('stream-ok')
    expect(opened).toEqual([{ songKey: 'wy_s1', range: 'bytes=0-1' }])
  })
})
