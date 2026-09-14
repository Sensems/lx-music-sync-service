import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'
import { createRepos } from '../src/db/repos.js'
import { formatFileName, getExt, safeDirName } from '../src/lib/names.js'
import { createSyncService } from '../src/services/sync.js'
import type { MusicInfo, Quality } from '../src/types.js'
import type { SourceStatus } from '../src/userApi/runtime.js'
import type { DownloadFileOptions } from '../src/download/downloader.js'
import type { PlaylistRow } from '../src/db/repos.js'

const musicInfo: MusicInfo = {
  id: 'wy_1',
  name: 'Song',
  singer: 'Artist',
  source: 'wy',
  interval: null,
  meta: {
    qualitys: [{ type: '320k', size: '1M' }],
    _qualitys: { '320k': { size: '1M' } },
  },
}

const okStatus = (): SourceStatus => ({
  ok: true,
  message: '',
  sources: {
    wy: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
  },
})

function trackRow(playlistId: number, info: MusicInfo = musicInfo) {
  return {
    playlist_id: playlistId,
    song_key: info.id,
    name: info.name,
    singer: info.singer,
    album: '',
    qualitys: JSON.stringify(info.meta.qualitys ?? []),
    raw: JSON.stringify(info),
  }
}

function expectedPath(savePath: string, saveDir: string, info: MusicInfo, quality: Quality = '320k') {
  const base = formatFileName('name-singer', info.name, info.singer)
  return join(savePath, saveDir, `${base}.${getExt(quality)}`)
}

function makeHarness(opts?: {
  hangRefresh?: boolean
  tracks?: MusicInfo[]
}) {
  const root = mkdtempSync(join(tmpdir(), 'tg-sync-'))
  const savePath = join(root, 'music')
  mkdirSync(savePath, { recursive: true })
  const db = openDb(join(root, 't.db'))
  const repos = createRepos(db)
  repos.settings.setMany({ savePath, quality: '320k', concurrency: '3', fileName: 'name-singer' })

  let downloadCalls = 0
  const downloadFile = async (o: DownloadFileOptions) => {
    downloadCalls++
    mkdirSync(dirname(o.destPath), { recursive: true })
    writeFileSync(o.destPath, Buffer.alloc(128, 7))
    o.onProgress?.({ downloaded: 128, total: 128 })
  }

  let releaseHang!: (p: PlaylistRow) => void
  const hangPromise = new Promise<PlaylistRow>(r => {
    releaseHang = r
  })

  const tracks = opts?.tracks ?? [musicInfo]

  const refreshPlaylistSnapshot = async (id: number): Promise<PlaylistRow> => {
    if (opts?.hangRefresh) {
      return hangPromise.then(async () => {
        const p = repos.playlists.get(id)!
        repos.tracks.replaceAll(
          id,
          tracks.map(t => trackRow(id, t)),
        )
        return p
      })
    }
    const p = repos.playlists.get(id)!
    if (!p.save_dir) {
      repos.playlists.updateAfterRefresh(id, { save_dir: safeDirName(p.name || 'unnamed') })
    }
    repos.tracks.replaceAll(
      id,
      tracks.map(t => trackRow(id, t)),
    )
    return repos.playlists.get(id)!
  }

  const getMusicUrl = async (_s: string, _m: MusicInfo, q: Quality) => ({
    type: q,
    url: 'http://example.com/a.mp3',
  })

  const sync = createSyncService({
    repos,
    refreshPlaylistSnapshot,
    getMusicUrl,
    getSourceStatus: okStatus,
    downloadFile,
  })

  return {
    root,
    savePath,
    repos,
    sync,
    get downloadCalls() {
      return downloadCalls
    },
    releaseHang: () => {
      const p = repos.playlists.list().find(x => x.enabled === 1) ?? repos.playlists.list()[0]!
      releaseHang(p)
    },
  }
}

describe('sync', () => {
  it('skips existing song_key when file exists', async () => {
    const h = makeHarness()
    const p = h.repos.playlists.insert({ source: 'wy', url: '123' })
    h.repos.playlists.updateAfterRefresh(p.id, { name: 'MyList', save_dir: 'MyList' })
    const dest = expectedPath(h.savePath, 'MyList', musicInfo)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, Buffer.from('already-here-content-xxxx'))
    h.repos.downloads.upsert({
      song_key: musicInfo.id,
      file_path: dest,
      quality: '320k',
      playlist_id: p.id,
      source_kind: 'playlist',
      completed_at: Date.now(),
    })

    const job = await h.sync.syncPlaylist(p.id)
    expect(job.status).toBe('success')
    expect(job.skipped).toBe(1)
    expect(job.downloaded).toBe(0)
    expect(h.downloadCalls).toBe(0)
  })

  it('does not delete local file when snapshot shrinks', async () => {
    let currentTracks: MusicInfo[] = [musicInfo]
    const root = mkdtempSync(join(tmpdir(), 'tg-sync-'))
    const savePath = join(root, 'music')
    mkdirSync(savePath, { recursive: true })
    const db = openDb(join(root, 't.db'))
    const repos = createRepos(db)
    repos.settings.setMany({ savePath, quality: '320k', concurrency: '3', fileName: 'name-singer' })

    let downloadCalls = 0
    const sync = createSyncService({
      repos,
      refreshPlaylistSnapshot: async (id) => {
        const p = repos.playlists.get(id)!
        if (!p.save_dir) {
          repos.playlists.updateAfterRefresh(id, { name: 'Shrink', save_dir: 'Shrink' })
        }
        repos.tracks.replaceAll(
          id,
          currentTracks.map(t => trackRow(id, t)),
        )
        return repos.playlists.get(id)!
      },
      getMusicUrl: async (_s, _m, q) => ({ type: q, url: 'http://example.com/a.mp3' }),
      getSourceStatus: okStatus,
      downloadFile: async (o) => {
        downloadCalls++
        mkdirSync(dirname(o.destPath), { recursive: true })
        writeFileSync(o.destPath, Buffer.alloc(128, 7))
      },
    })

    const p = repos.playlists.insert({ source: 'wy', url: '123' })
    const job1 = await sync.syncPlaylist(p.id)
    expect(job1.downloaded).toBe(1)
    expect(downloadCalls).toBe(1)

    const row = repos.downloads.get(musicInfo.id)!
    expect(existsSync(row.file_path)).toBe(true)
    const before = readFileSync(row.file_path)

    currentTracks = []
    const job2 = await sync.syncPlaylist(p.id)
    expect(job2.scanned).toBe(0)
    expect(existsSync(row.file_path)).toBe(true)
    expect(repos.downloads.get(musicInfo.id)?.file_path).toBe(row.file_path)
    expect(readFileSync(row.file_path).equals(before)).toBe(true)
  })

  it('queues concurrent sync jobs instead of skipping', async () => {
    const h = makeHarness({ hangRefresh: true })
    const p1 = h.repos.playlists.insert({ source: 'wy', url: '111' })
    const p2 = h.repos.playlists.insert({ source: 'wy', url: '222' })

    const firstPromise = h.sync.syncPlaylist(p1.id)
    await new Promise(r => setTimeout(r, 20))
    const secondPromise = h.sync.syncPlaylist(p2.id)

    let secondSettled = false
    void secondPromise.then(() => {
      secondSettled = true
    })
    await new Promise(r => setTimeout(r, 20))
    expect(secondSettled).toBe(false)

    h.releaseHang()
    const first = await firstPromise
    expect(first.status).toBe('success')
    expect(first.playlist_id).toBe(p1.id)

    const second = await secondPromise
    expect(second.status).toBe('success')
    expect(second.playlist_id).toBe(p2.id)
    expect(second.id).not.toBe(first.id)
  })

  it('queues reentrant syncAll behind the active job', async () => {
    const h = makeHarness({ hangRefresh: true })
    h.repos.playlists.insert({ source: 'wy', url: '123' })

    const firstPromise = h.sync.syncAll()
    await new Promise(r => setTimeout(r, 20))
    const secondPromise = h.sync.syncAll()

    let secondSettled = false
    void secondPromise.then(() => {
      secondSettled = true
    })
    await new Promise(r => setTimeout(r, 20))
    expect(secondSettled).toBe(false)

    h.releaseHang()
    const first = await firstPromise
    expect(first.status).toBe('success')

    const second = await secondPromise
    expect(second.status).toBe('success')
    expect(second.id).not.toBe(first.id)
  })

  it('search download lands under search/ and later playlist skip', async () => {
    const h = makeHarness()
    const row = await h.sync.downloadSearch(musicInfo)
    expect(row.source_kind).toBe('search')
    expect(row.playlist_id).toBeNull()
    expect(row.file_path).toContain(join('search'))
    expect(existsSync(row.file_path)).toBe(true)
    expect(statSync(row.file_path).size).toBeGreaterThan(100)
    expect(h.downloadCalls).toBe(1)

    const p = h.repos.playlists.insert({ source: 'wy', url: '123' })
    h.repos.playlists.updateAfterRefresh(p.id, { name: 'PL', save_dir: 'PL' })
    const job = await h.sync.syncPlaylist(p.id)
    expect(job.skipped).toBe(1)
    expect(job.downloaded).toBe(0)
    expect(h.downloadCalls).toBe(1)
  })
})
