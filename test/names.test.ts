import { describe, expect, it } from 'vitest'
import { formatFileName, getExt, pickQuality, safeDirName } from '../src/lib/names'
import { toNewMusicInfo } from '../src/lib/toNewMusicInfo'

describe('getExt', () => {
  it('maps bitrate to mp3 and flac families to flac', () => {
    expect(getExt('320k')).toBe('mp3')
    expect(getExt('flac24bit')).toBe('flac')
  })
})

describe('pickQuality', () => {
  it('falls back along QUALITYS then to 128k', () => {
    expect(pickQuality('flac', ['320k', '128k'], { '320k': {} })).toBe('320k')
    expect(pickQuality('flac', ['128k'], {})).toBe('128k')
  })
})

describe('names', () => {
  it('strips path characters from save_dir', () => {
    expect(safeDirName('a/b:c*')).not.toMatch(/[\\/:*?"<>|]/)
  })
  it('formats 歌名 - 歌手', () => {
    expect(formatFileName('name-singer', '起风了', '买辣椒也用券')).toBe('起风了 - 买辣椒也用券')
  })
})

describe('toNewMusicInfo', () => {
  it('uses source_songmid except kugou hash form', () => {
    expect(toNewMusicInfo({ source: 'wy', songmid: '123', name: 'a', singer: 'b', types: [], _types: {} }).id).toBe('wy_123')
    expect(toNewMusicInfo({ source: 'kg', songmid: 'm1', hash: 'h1', name: 'a', singer: 'b', types: [], _types: {} }).id).toBe('m1_h1')
  })
})
