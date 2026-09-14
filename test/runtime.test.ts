import { describe, expect, it } from 'vitest'
import { createUserApiRuntime, detectScriptKind, toCeruMusicInfo } from '../src/userApi/runtime'

const okScript = `/*
 * @name fixture
 * @version 0.0.1
 */
lx.on('request', ({ action, info }) => {
  if (action === 'musicUrl') return Promise.resolve('https://example.com/a.mp3')
})
lx.send('inited', {
  sources: {
    wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] },
  },
})
`

const ceruScript = `/*!
 * @name ceru-fixture
 * @version 1.0.0
 */
const { request, NoticeCenter, version } = cerumusic
async function musicUrl(source, musicInfo, quality) {
  if (!version) throw new Error('missing version')
  NoticeCenter('info', { title: 'ok' })
  if (musicInfo.hash) return 'https://example.com/' + musicInfo.hash + '.mp3'
  return 'https://example.com/' + musicInfo.songmid + '-' + quality + '.mp3'
}
module.exports = {
  pluginInfo: { name: 'ceru-fixture', version: '1.0.0', author: 't' },
  sources: {
    wy: { name: '网易', qualitys: ['128k', '320k', 'flac'] },
    kg: { name: '酷狗', qualitys: ['128k', '320k'] },
  },
  musicUrl,
}
`

describe('user api runtime', () => {
  it('inits and returns musicUrl', async () => {
    const rt = createUserApiRuntime()
    const status = await rt.load(okScript)
    expect(status.ok).toBe(true)
    expect(status.sources.wy.qualitys).toContain('320k')
    const { url } = await rt.getMusicUrl('wy', { id: 'wy_1', name: 'n', singer: 's', source: 'wy', interval: null, meta: {} } as any, '320k')
    expect(url).toBe('https://example.com/a.mp3')
    rt.dispose()
  })

  it('rejects non-http url', async () => {
    const rt = createUserApiRuntime()
    await rt.load(okScript.replace('https://example.com/a.mp3', 'ftp://x'))
    await expect(rt.getMusicUrl('wy', { id: 'wy_1', name: 'n', singer: 's', source: 'wy', interval: null, meta: {} } as any, '128k')).rejects.toThrow()
    rt.dispose()
  })

  it('marks init failed on throw', async () => {
    const rt = createUserApiRuntime()
    const status = await rt.load('/*\n * @name x\n */\nthrow new Error("boom")')
    expect(status.ok).toBe(false)
    expect(status.message).toMatch(/boom/)
    rt.dispose()
  })

  it('detects ceru vs lx scripts', () => {
    expect(detectScriptKind(ceruScript)).toBe('ceru')
    expect(detectScriptKind(okScript)).toBe('lx')
  })

  it('loads CeruMusic plugin and resolves musicUrl', async () => {
    const rt = createUserApiRuntime()
    const status = await rt.load(ceruScript)
    expect(status.ok).toBe(true)
    expect(status.name).toBe('ceru-fixture')
    expect(status.sources.wy.actions).toContain('musicUrl')
    expect(status.sources.wy.qualitys).toEqual(['128k', '320k', 'flac'])

    const { url } = await rt.getMusicUrl(
      'wy',
      { id: 'wy_99', name: 'n', singer: 's', source: 'wy', interval: null, meta: { songId: '99' } } as any,
      '320k',
    )
    expect(url).toBe('https://example.com/99-320k.mp3')

    const kg = await rt.getMusicUrl(
      'kg',
      { id: '1_abc', name: 'n', singer: 's', source: 'kg', interval: null, meta: { hash: 'abc', songId: '1' } } as any,
      '128k',
    )
    expect(kg.url).toBe('https://example.com/abc.mp3')
    rt.dispose()
  })

  it('flattens songmid/hash for Ceru plugins', () => {
    const info = toCeruMusicInfo({
      id: 'wy_1',
      name: 'n',
      singer: 's',
      source: 'wy',
      interval: null,
      meta: { songId: 'mid', hash: 'h' },
    })
    expect(info.songmid).toBe('mid')
    expect(info.hash).toBe('h')
  })
})
