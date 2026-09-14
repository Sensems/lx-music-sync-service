import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index'
import { createRepos } from '../src/db/repos'
import { safeDirName } from '../src/lib/names'
import { createPlaylistService } from '../src/services/playlists'

describe('refreshPlaylistSnapshot', () => {
  it('sets save_dir once and does not overwrite custom name', async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tg-')), 't.db'))
    const repos = createRepos(db)
    const p = repos.playlists.insert({ source: 'wy', url: '123' })

    let onlineName = '线上标题/危险'
    const svc = createPlaylistService(repos, {
      getListDetail: async (_source, _id, page) => ({
        list:
          page === 1
            ? [
                {
                  songmid: '99',
                  name: 'song',
                  singer: 's',
                  source: 'wy',
                  interval: '03:00',
                  albumName: 'al',
                  types: [{ type: '320k', size: '1M' }],
                  _types: { '320k': { size: '1M' } },
                  img: '',
                  albumId: '',
                },
              ]
            : [],
        page,
        limit: 30,
        total: 1,
        source: 'wy',
        info: { name: onlineName, img: '', desc: '', author: '' },
      }),
    })

    const afterFirst = await svc.refreshPlaylistSnapshot(p.id)
    expect(afterFirst.name).toBe('线上标题/危险')
    expect(afterFirst.save_dir).toBe(safeDirName('线上标题/危险'))
    expect(repos.tracks.list(p.id)).toHaveLength(1)
    expect(repos.tracks.list(p.id)[0]!.song_key).toBe('wy_99')

    repos.playlists.patch(p.id, { name: '本地名' })
    onlineName = '线上新名'
    const afterSecond = await svc.refreshPlaylistSnapshot(p.id)
    expect(afterSecond.name).toBe('本地名')
    expect(afterSecond.save_dir).toBe(safeDirName('线上标题/危险'))
  })

  it('paginates until all tracks collected', async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tg-')), 't.db'))
    const repos = createRepos(db)
    const p = repos.playlists.insert({ source: 'kw', url: 'u' })

    const svc = createPlaylistService(repos, {
      getListDetail: async (_source, _id, page) => ({
        list: [
          {
            songmid: String(page),
            name: `n${page}`,
            singer: 's',
            source: 'kw',
            interval: null,
            albumName: '',
            types: [],
            _types: {},
          },
        ],
        page,
        limit: 1,
        total: 2,
        source: 'kw',
        info: { name: 'plist', img: '', desc: '', author: '' },
      }),
    })

    await svc.refreshPlaylistSnapshot(p.id)
    expect(repos.tracks.list(p.id).map(t => t.song_key)).toEqual(['kw_1', 'kw_2'])
  })
})
