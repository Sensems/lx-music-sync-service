import { describe, expect, it } from 'vitest'
import type { DownloadRow, JobRow } from '../src/db/repos.js'
import type { CliDeps } from '../src/cli.js'
import type { MusicInfo } from '../src/types.js'

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  const playlists: Array<{ id: number; source: string; url: string; name: string; enabled: number }> =
    []
  let nextId = 1

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

  const base: CliDeps = {
    repos: {
      playlists: {
        list: () => playlists.slice(),
        get: (id: number) => playlists.find(p => p.id === id) ?? null,
        insert: ({ source, url }) => {
          const row = {
            id: nextId++,
            source,
            url,
            name: '',
            enabled: 1,
            save_dir: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          }
          playlists.push(row)
          return row
        },
        remove: (id: number) => {
          const i = playlists.findIndex(p => p.id === id)
          if (i >= 0) playlists.splice(i, 1)
        },
        patch: () => {
          throw new Error('not used')
        },
        updateAfterRefresh: () => {
          throw new Error('not used')
        },
      },
    } as CliDeps['repos'],
    sync: {
      async syncPlaylist(id: number) {
        return fakeJob({ kind: 'playlist', playlist_id: id, id: 11 })
      },
      async syncAll() {
        return fakeJob({ kind: 'all', playlist_id: null, id: 12 })
      },
      async downloadSearch(musicInfo: MusicInfo): Promise<DownloadRow> {
        return {
          song_key: musicInfo.id,
          file_path: `/tmp/${musicInfo.id}.mp3`,
          quality: '320k',
          playlist_id: null,
          source_kind: 'search',
          completed_at: Date.now(),
        }
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
    log: () => {},
    error: () => {},
  }

  return { ...base, ...overrides }
}

describe('runCli', () => {
  it('playlist add without source exits 1', async () => {
    const { runCli } = await import('../src/cli.js')
    const code = await runCli(['playlist', 'add', '--url', 'x'], fakeDeps())
    expect(code).toBe(1)
  })

  it('search prints json list', async () => {
    const { runCli } = await import('../src/cli.js')
    const logs: string[] = []
    await runCli(['search', '--source', 'all', '--q', '起风了'], {
      ...fakeDeps(),
      log: s => logs.push(s),
    })
    expect(logs.join('\n')).toMatch(/起风了/)
  })
})
