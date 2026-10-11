import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { MusicInfo } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'

export type AppCtx = {
  dataDir: string
  runtime: {
    load(script: string): Promise<SourceStatus>
    getStatus(): SourceStatus
    setProxy(proxy: { host: string; port: number } | null): void
  }
}

function asMusicInfo(body: Record<string, unknown>): MusicInfo | null {
  if (body.musicInfo && typeof body.musicInfo === 'object') {
    return body.musicInfo as MusicInfo
  }
  const source = body.source
  const id = body.id
  if (typeof source === 'string' && (typeof id === 'string' || typeof id === 'number')) {
    const platformId = String(id)
    const songKey = platformId.includes('_') ? platformId : `${source}_${platformId}`
    return {
      id: songKey,
      name: platformId,
      singer: '',
      source: source as MusicInfo['source'],
      interval: null,
      meta: {},
    }
  }
  return null
}

function lyricDisplayFields(musicInfo: MusicInfo) {
  return {
    name: musicInfo.name,
    singer: musicInfo.singer,
    source: musicInfo.source,
    picUrl: String(musicInfo.meta?.picUrl || ''),
  }
}

async function lyricPayload(songKey: string, musicInfo: MusicInfo) {
  const display = lyricDisplayFields(musicInfo)
  try {
    const { getLyricForMusic } = await import('../services/lyrics.js')
    const lyric = await getLyricForMusic(musicInfo)
    return {
      songKey,
      ...display,
      lyric: lyric.lyric || '',
      tlyric: lyric.tlyric || '',
    }
  } catch {
    return {
      songKey,
      ...display,
      lyric: '',
      tlyric: '',
    }
  }
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    /* empty */
  }
  return {}
}

export function createApp(ctx: AppCtx): Hono {
  const app = new Hono()
  const { runtime, dataDir } = ctx

  app.get('/api/source/status', (c) => {
    return c.json(runtime.getStatus())
  })

  app.post('/api/lyrics', async (c) => {
    const body = await readJson(c)
    const musicInfo = asMusicInfo(body)
    const songKey = typeof body.songKey === 'string' ? body.songKey : musicInfo?.id
    if (!musicInfo?.id || !songKey) return c.json({ error: 'musicInfo or songKey required' }, 400)
    return c.json(await lyricPayload(songKey, musicInfo))
  })

  app.post('/api/settings/user-api', async (c) => {
    const body = await c.req.parseBody()
    const file = body.file
    if (!file || typeof file === 'string') {
      return c.json({ error: 'file required' }, 400)
    }
    const script = await (file as File).text()
    const dir = join(dataDir, 'user-api')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'current.js'), script, 'utf8')
    const status = await runtime.load(script)
    return c.json(status)
  })

  app.post('/api/settings/user-api/url', async (c) => {
    const body = await readJson(c)
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
    if (!rawUrl) {
      return c.json({ error: 'url required' }, 400)
    }
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return c.json({ error: 'invalid url' }, 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return c.json({ error: 'only http(s) urls are allowed' }, 400)
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(parsed.toString(), {
          signal: controller.signal,
          redirect: 'follow',
          headers: { Accept: 'text/plain, application/javascript, */*' },
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        return c.json({ error: `download failed: ${res.status}` }, 400)
      }
      const script = await res.text()
      if (!script.trim()) {
        return c.json({ error: 'empty script' }, 400)
      }
      const dir = join(dataDir, 'user-api')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'current.js'), script, 'utf8')
      const status = await runtime.load(script)
      return c.json(status)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 400)
    }
  })

  return app
}
