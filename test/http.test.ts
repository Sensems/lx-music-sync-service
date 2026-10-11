import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/http/app.js'
import type { SourceStatus } from '../src/userApi/runtime.js'

function makeTestCtx(): AppCtx & { _test: { loaded: string[]; proxyUpdates: Array<{ host: string; port: number } | null> } } {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-http-'))

  let status: SourceStatus = {
    ok: true,
    message: '',
    name: 'test-source',
    version: '1.0.0',
    sources: { wy: { actions: ['musicUrl'], qualitys: ['128k', '320k'] } },
  }
  const loaded: string[] = []
  const proxyUpdates: Array<{ host: string; port: number } | null> = []

  return {
    dataDir,
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
  }
}

describe('search jobs downloads settings', () => {
  it('validates source status and user-api upload', async () => {
    const { createApp: create } = await import('../src/http/app.js')
    const ctx = makeTestCtx()
    const app = create(ctx)

    const status = await app.request('/api/source/status')
    expect(status.status).toBe(200)
    expect((await status.json()).name).toBe('test-source')

    const form = new FormData()
    form.append('file', new File(['/** @name u @description d @version 2.0.0 @author a */\n'], 'api.js'))
    const upload = await app.request('/api/settings/user-api', { method: 'POST', body: form })
    expect(upload.status).toBe(200)
    expect(ctx._test.loaded.length).toBe(1)
    expect((await upload.json()).name).toBe('uploaded')
  })
})

describe('POST /api/lyrics', () => {
  it('accepts musicInfo without a download row', async () => {
    const { createApp: create } = await import('../src/http/app.js')
    const app = create(makeTestCtx())
    const res = await app.request('/api/lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        musicInfo: {
          id: 'wy_lyric',
          name: '词',
          singer: '唱',
          source: 'wy',
          interval: null,
          meta: {},
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('lyric')
    expect(body).toHaveProperty('tlyric')
    expect(body.songKey).toBe('wy_lyric')
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
