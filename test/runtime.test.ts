import { describe, expect, it } from 'vitest'
import { createUserApiRuntime } from '../src/userApi/runtime'

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
})
