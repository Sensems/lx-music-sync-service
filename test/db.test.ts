import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index'
import { createRepos } from '../src/db/repos'

describe('playlists and downloads', () => {
  it('remove cascades playlist_tracks and keeps downloads', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tg-')), 't.db'))
    const repos = createRepos(db)
    const p = repos.playlists.insert({ source: 'wy', url: 'https://music.163.com/playlist?id=1' })
    repos.tracks.replaceAll(p.id, [
      { playlist_id: p.id, song_key: 'wy_1', name: 'a', singer: 'b', album: '', qualitys: '[]', raw: '{}' },
    ])
    repos.downloads.upsert({
      song_key: 'wy_1',
      file_path: '/tmp/a.mp3',
      quality: '320k',
      playlist_id: p.id,
      source_kind: 'playlist',
      completed_at: Date.now(),
    })
    expect(repos.tracks.list(p.id)).toHaveLength(1)
    repos.playlists.remove(p.id)
    expect(repos.tracks.list(p.id)).toEqual([])
    expect(repos.downloads.get('wy_1')?.file_path).toBe('/tmp/a.mp3')
  })

  it('replaceAll overwrites snapshot only for that playlist', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tg-')), 't.db'))
    const repos = createRepos(db)
    const p = repos.playlists.insert({ source: 'wy', url: 'u' })
    repos.tracks.replaceAll(p.id, [{ playlist_id: p.id, song_key: 'wy_1', name: 'a', singer: 'b', album: '', qualitys: '[]', raw: '{}' }])
    repos.tracks.replaceAll(p.id, [{ playlist_id: p.id, song_key: 'wy_2', name: 'c', singer: 'd', album: '', qualitys: '[]', raw: '{}' }])
    expect(repos.tracks.list(p.id).map(t => t.song_key)).toEqual(['wy_2'])
  })

  it('patch name sets name_custom', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tg-')), 't.db'))
    const repos = createRepos(db)
    const p = repos.playlists.insert({ source: 'kw', url: '1' })
    const updated = repos.playlists.patch(p.id, { name: '本地名' })
    expect(updated.name_custom).toBe(1)
    expect(updated.name).toBe('本地名')
  })

  it('backfills download cover meta from playlist_tracks', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tg-')), 't.db')
    const db = openDb(file)
    const repos = createRepos(db)
    const p = repos.playlists.insert({ source: 'wy', url: 'https://music.163.com/playlist?id=1' })
    repos.tracks.replaceAll(p.id, [
      {
        playlist_id: p.id,
        song_key: 'wy_99',
        name: '封面歌',
        singer: '歌手',
        album: '专',
        qualitys: '[]',
        raw: JSON.stringify({
          id: 'wy_99',
          name: '封面歌',
          singer: '歌手',
          source: 'wy',
          interval: null,
          meta: { picUrl: 'https://example.com/cover.jpg' },
        }),
      },
    ])
    repos.downloads.upsert({
      song_key: 'wy_99',
      file_path: '/tmp/cover.mp3',
      quality: '320k',
      playlist_id: p.id,
      source_kind: 'playlist',
      completed_at: Date.now(),
    })
    db.close()

    const db2 = openDb(file)
    const repos2 = createRepos(db2)
    const row = repos2.downloads.get('wy_99')
    expect(row?.name).toBe('封面歌')
    expect(row?.source).toBe('wy')
    expect(row?.pic_url).toBe('https://example.com/cover.jpg')
  })
})
