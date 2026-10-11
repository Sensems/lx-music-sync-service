import type { Hono } from 'hono'
import cron from 'node-cron'
import type { Pool, PoolClient } from 'pg'
import { isAllowedSchedule, resolveCronExpression } from '../lib/cronExpr.js'
import { cachePlaylist, cacheSong } from '../library/cache.js'
import { ingestTrackFromMusic } from '../library/normalize.js'
import { setSubsonicPassword } from '../library/password.js'
import { scanRoot } from '../library/scan.js'
import { createSubscription, refreshSubscription } from '../library/subscribe.js'
import { upsertTrack } from '../library/upsert.js'
import { pickQuality, QUALITYS } from '../lib/names.js'
import type { createJobQueue } from '../jobs/queue.js'
import type { GetListDetail } from '../services/playlists.js'
import type { MusicInfo, OnlineSource, Quality } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'

const PLATFORMS: readonly OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']
const BIGINT_MAX = 9223372036854775807n
const PASSWORD_KEY = 'subsonicPassword'

const SETTINGS_DEFAULTS: Record<string, string> = {
  quality: '128k',
  sourceOrder: 'kw,kg,tx,wy,mg',
  scheduleOn: '0',
  schedule: 'every-6h',
  scheduleTime: '03:00',
  cron: '',
  scanWithSchedule: '0',
  subsonicUser: 'tinggui',
}

const SETTINGS_KEYS = new Set(Object.keys(SETTINGS_DEFAULTS))

export type ManageCronSnapshot = {
  scheduleOn?: string
  schedule?: string
  cron?: string
  scheduleTime?: string
  scanWithSchedule?: string
}

export const CRON_DEFAULTS: ManageCronSnapshot = {
  scheduleOn: '0',
  schedule: 'every-6h',
  scheduleTime: '03:00',
  cron: '',
  scanWithSchedule: '0',
}

export type ManageDeps = {
  pool: Pool
  dataDir: string
  cacheDir: string
  search: {
    searchMusic(
      source: OnlineSource | 'all',
      q: string,
      page: number,
    ): Promise<{ list: MusicInfo[]; total: number }>
  }
  getListDetail: GetListDetail
  getMusicUrl: (source: string, musicInfo: MusicInfo, quality: Quality) => Promise<{ type: Quality; url: string }>
  runtime: {
    getStatus(): SourceStatus
  }
  jobs: ReturnType<typeof createJobQueue>
  cronSnapshot: ManageCronSnapshot
  rescheduleCron?: () => void
}

type SourceRow = {
  platform: string
  platform_song_id: string
  raw: unknown
}

/** 歌曲 / 歌单 / 根 id 都是 bigint 文本。非法值不要送进 SQL。 */
function isLibraryId(id: string): boolean {
  if (!/^\d+$/.test(id)) return false
  try {
    const value = BigInt(id)
    return value >= 0n && value <= BIGINT_MAX
  } catch {
    return false
  }
}

function isPlatform(value: string): value is OnlineSource {
  return (PLATFORMS as readonly string[]).includes(value)
}

function asPlatform(value: unknown): OnlineSource | null {
  return typeof value === 'string' && isPlatform(value) ? value : null
}

function asMusicInfo(body: Record<string, unknown>): MusicInfo | null {
  const source = body.source
  const id = body.id
  if (typeof source !== 'string' || (typeof id !== 'string' && typeof id !== 'number')) return null
  const meta = body.meta
  return {
    id: String(id),
    name: typeof body.name === 'string' ? body.name : '',
    singer: typeof body.singer === 'string' ? body.singer : '',
    source: source as MusicInfo['source'],
    interval: body.interval as MusicInfo['interval'],
    meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 刮削在事务外已经结束。这里任何 SQL 失败都要回滚，
 * 否则半截 upsert 会留下新歌。
 */
async function inTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    try {
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackErr) {
        broken = rollbackErr instanceof Error ? rollbackErr : new Error('rollback failed')
      }
      throw err
    }
  } finally {
    client.release(broken)
  }
}

function parseSourceOrderInput(value: string): string | null {
  const parts = value.split(',').map((part) => part.trim()).filter((part) => part.length > 0)
  if (parts.length !== 5) return null
  const seen = new Set<string>()
  for (const part of parts) {
    if (!isPlatform(part) || seen.has(part)) return null
    seen.add(part)
  }
  return parts.join(',')
}

function parseQualityInput(value: string): Quality | null {
  return (QUALITYS as readonly string[]).includes(value) ? (value as Quality) : null
}

function parseSourceOrder(raw: string | null): OnlineSource[] {
  if (raw == null || raw.trim() === '') return [...PLATFORMS]
  const seen = new Set<OnlineSource>()
  const order: OnlineSource[] = []
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (!isPlatform(name) || seen.has(name)) continue
    seen.add(name)
    order.push(name)
  }
  return order.length > 0 ? order : [...PLATFORMS]
}

function parseQuality(raw: string | null): Quality {
  const value = raw?.trim() ?? ''
  return parseQualityInput(value) ?? '128k'
}

async function readSetting(pool: Pool, key: string): Promise<string | null> {
  const found = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key])
  return found.rows[0]?.value ?? null
}

async function writeSetting(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  )
}

/** 定时回调是同步读这份快照的。改设置时必须先写这里，再 reschedule。 */
export async function loadCronSnapshot(pool: Pool, target: ManageCronSnapshot): Promise<void> {
  const found = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings
     WHERE key = ANY($1::text[])`,
    [['scheduleOn', 'schedule', 'scheduleTime', 'cron', 'scanWithSchedule']],
  )
  Object.assign(target, CRON_DEFAULTS)
  for (const row of found.rows) {
    if (row.key === 'scheduleOn') target.scheduleOn = row.value
    else if (row.key === 'schedule') target.schedule = row.value
    else if (row.key === 'scheduleTime') target.scheduleTime = row.value
    else if (row.key === 'cron') target.cron = row.value
    else if (row.key === 'scanWithSchedule') target.scanWithSchedule = row.value
  }
}

function applyCronSnapshot(target: ManageCronSnapshot, partial: Record<string, string>): void {
  if ('scheduleOn' in partial) target.scheduleOn = partial.scheduleOn
  if ('schedule' in partial) target.schedule = partial.schedule
  if ('scheduleTime' in partial) target.scheduleTime = partial.scheduleTime
  if ('cron' in partial) target.cron = partial.cron
  if ('scanWithSchedule' in partial) target.scanWithSchedule = partial.scanWithSchedule
}

/**
 * 校验的是合并后真正会拿去 schedule 的表达式。
 * every-6h / daily 时残留的 cron 字符串不单独判定；未知 schedule 直接拒。
 */
function cronWouldBeInvalid(current: ManageCronSnapshot, partial: Record<string, string>): boolean {
  const merged: ManageCronSnapshot = { ...current }
  applyCronSnapshot(merged, partial)
  if (!isAllowedSchedule(merged.schedule)) return true
  return !cron.validate(resolveCronExpression(merged))
}

async function settingsPayload(deps: ManageDeps): Promise<Record<string, string | boolean>> {
  const found = await deps.pool.query<{ key: string; value: string }>('SELECT key, value FROM settings')
  const out: Record<string, string> = { ...SETTINGS_DEFAULTS }
  for (const row of found.rows) {
    if (row.key === PASSWORD_KEY) continue
    if (!SETTINGS_KEYS.has(row.key)) continue
    out[row.key] = row.value
  }
  const status = deps.runtime.getStatus()
  return {
    ...out,
    name: status.name ?? '',
    version: status.version ?? '',
    sourceOk: status.ok,
    sourceMessage: status.message ?? '',
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value) as unknown)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * 没有 raw.id 时按入库规则补上。
 * 酷狗 id 已经是 songmid_hash，再加 kg_ 前缀脚本会对不上。
 */
function musicInfoFrom(platform: OnlineSource, platformSongId: string, raw: unknown): MusicInfo {
  const record = asRecord(raw) ?? {}
  const existingId = record.id
  const id = typeof existingId === 'string' && existingId.length > 0
    ? existingId
    : platform === 'kg'
      ? platformSongId
      : `${platform}_${platformSongId}`
  return {
    id,
    name: typeof record.name === 'string' ? record.name : '',
    singer: typeof record.singer === 'string' ? record.singer : '',
    source: platform,
    interval: record.interval as MusicInfo['interval'],
    meta: asRecord(record.meta) ?? {},
  }
}

function songQualitiesOf(music: MusicInfo): Partial<Record<Quality, unknown>> {
  const value = music.meta?._qualitys
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Partial<Record<Quality, unknown>>
}

function scriptQualities(status: SourceStatus, platform: string): Quality[] {
  const listed = status.sources[platform]?.qualitys ?? []
  const known = new Set<string>(QUALITYS)
  return listed.filter((item): item is Quality => known.has(item))
}

function chooseQuality(music: MusicInfo, sourceQualities: Quality[], wanted: Quality): Quality | null {
  if (sourceQualities.length === 0) return null
  const songQualities = songQualitiesOf(music)
  const picked = pickQuality(wanted, sourceQualities, songQualities)
  if (!songQualities[picked] || !sourceQualities.includes(picked)) return null
  return picked
}

function orderSources(rows: SourceRow[], order: readonly OnlineSource[]): SourceRow[] {
  const rank = new Map<OnlineSource, number>()
  order.forEach((platform, index) => {
    if (!rank.has(platform)) rank.set(platform, index)
  })
  return rows
    .map((row, index) => ({ row, index }))
    .filter((item): item is { row: SourceRow & { platform: OnlineSource }; index: number } => (
      isPlatform(item.row.platform) && rank.has(item.row.platform)
    ))
    .sort((a, b) => rank.get(a.row.platform)! - rank.get(b.row.platform)! || a.index - b.index)
    .map((item) => item.row)
}

async function resolveCacheUrl(
  deps: ManageDeps,
  songId: string,
): Promise<{ url: string; quality: Quality } | null> {
  const found = await deps.pool.query<SourceRow>(
    `SELECT platform, platform_song_id, raw
     FROM song_sources
     WHERE song_id = $1::bigint`,
    [songId],
  )
  const [orderRaw, qualityRaw] = await Promise.all([
    readSetting(deps.pool, 'sourceOrder'),
    readSetting(deps.pool, 'quality'),
  ])
  const ordered = orderSources(found.rows, parseSourceOrder(orderRaw))
  if (ordered.length === 0) return null

  let status: SourceStatus
  try {
    status = deps.runtime.getStatus()
  } catch {
    return null
  }
  if (!status?.sources) return null

  const wanted = parseQuality(qualityRaw)
  for (const row of ordered) {
    if (!isPlatform(row.platform)) continue
    const music = musicInfoFrom(row.platform, row.platform_song_id, row.raw)
    const quality = chooseQuality(music, scriptQualities(status, row.platform), wanted)
    if (!quality) continue
    try {
      const result = await deps.getMusicUrl(row.platform, music, quality)
      const url = String(result?.url ?? '').trim()
      if (/^https?:\/\//i.test(url)) return { url, quality }
    } catch {
      // 这一条身份取不到地址就试下一条，不能让整次缓存停住。
    }
  }
  return null
}

async function runScan(deps: ManageDeps): Promise<{ unmerged: string[]; unreadable: string[] }> {
  const roots = await deps.pool.query<{ path: string }>(
    `SELECT path FROM library_roots ORDER BY id`,
  )
  const unmerged: string[] = []
  const unreadable: string[] = []
  for (const root of roots.rows) {
    const counts = await inTransaction(deps.pool, (client) => scanRoot(client, root.path, deps.cacheDir))
    unmerged.push(...counts.unmerged)
    unreadable.push(...counts.unreadable)
  }
  return { unmerged, unreadable }
}

function enqueueRefresh(deps: ManageDeps, playlistId: string) {
  return deps.jobs.enqueue('refresh-subscription', { playlistId }, async (payload) => {
    const result = await refreshSubscription(deps.pool, String(payload.playlistId), deps.getListDetail)
    return { playlistId: result.playlistId, count: result.count }
  })
}

function enqueueScan(deps: ManageDeps) {
  return deps.jobs.enqueue('scan', {}, async () => runScan(deps))
}

function enqueueCacheSong(deps: ManageDeps, songId: string, replace: boolean) {
  const kind = replace ? 'recache' : 'cache-song'
  return deps.jobs.enqueue(kind, { songId, replace }, async (payload) => {
    const result = await cacheSong({
      pool: deps.pool,
      songId: String(payload.songId),
      cacheDir: deps.cacheDir,
      replace: payload.replace === true,
      resolveUrl: (id) => resolveCacheUrl(deps, id),
    })
    return result
  })
}

function enqueueCachePlaylist(deps: ManageDeps, playlistId: string) {
  return deps.jobs.enqueue('cache-playlist', { playlistId }, async (payload) => {
    return cachePlaylist({
      pool: deps.pool,
      playlistId: String(payload.playlistId),
      cacheDir: deps.cacheDir,
      replace: false,
      resolveUrl: (id) => resolveCacheUrl(deps, id),
    })
  })
}

/** 定时只刷新订阅；scanWithSchedule 开了才扫。不要在定时里缓存。 */
export async function enqueueScheduledWork(deps: ManageDeps): Promise<void> {
  const subs = await deps.pool.query<{ id: string }>(
    `SELECT id::text AS id FROM playlists WHERE kind = 'subscription' ORDER BY id`,
  )
  for (const row of subs.rows) {
    await enqueueRefresh(deps, row.id)
  }
  if (deps.cronSnapshot.scanWithSchedule === '1') {
    await enqueueScan(deps)
  }
}

export function mountManage(app: Hono, deps: ManageDeps): void {
  app.post('/api/subscriptions', async (c) => {
    const body = await readJson(c)
    const platform = asPlatform(body.platform)
    const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
    if (!platform || !sourceUrl) {
      return c.json({ error: 'platform and sourceUrl required' }, 400)
    }
    try {
      const created = await createSubscription(deps.pool, { platform, sourceUrl })
      return c.json(created)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500)
    }
  })

  app.get('/api/subscriptions', async (c) => {
    const found = await deps.pool.query<{
      id: string
      kind: string
      name: string
      source_url: string
      platform: string
      created_at: Date
      updated_at: Date
    }>(
      `SELECT id::text AS id, kind, name, source_url, platform, created_at, updated_at
       FROM playlists
       WHERE kind = 'subscription'
       ORDER BY id`,
    )
    return c.json({ list: found.rows })
  })

  app.post('/api/subscriptions/:id/refresh', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    const found = await deps.pool.query(
      `SELECT 1 FROM playlists WHERE id = $1::bigint AND kind = 'subscription'`,
      [id],
    )
    if ((found.rowCount ?? 0) === 0) return c.json({ error: 'not found' }, 404)
    const job = await enqueueRefresh(deps, id)
    return c.json(job)
  })

  app.delete('/api/subscriptions/:id', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    // 只删歌单行。成员随外键走，歌曲和缓存文件都留着。
    const deleted = await deps.pool.query(
      `DELETE FROM playlists WHERE id = $1::bigint AND kind = 'subscription'`,
      [id],
    )
    if ((deleted.rowCount ?? 0) === 0) return c.json({ error: 'not found' }, 404)
    return c.body(null, 204)
  })

  app.get('/api/search', async (c) => {
    const q = c.req.query('q')
    if (!q) return c.json({ error: 'q required' }, 400)
    const source = (c.req.query('source') || 'all') as OnlineSource | 'all'
    const page = Math.max(1, Number(c.req.query('page') || '1') || 1)
    const result = await deps.search.searchMusic(source, q, page)
    return c.json(result)
  })

  app.post('/api/library/tracks', async (c) => {
    const body = await readJson(c)
    const music = asMusicInfo(body)
    if (!music) return c.json({ error: 'MusicInfo required' }, 400)
    try {
      const track = ingestTrackFromMusic(music)
      const saved = await inTransaction(deps.pool, (client) => upsertTrack(client, track))
      return c.json(saved)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
  })

  app.post('/api/library/roots', async (c) => {
    const body = await readJson(c)
    const rootPath = typeof body.path === 'string' ? body.path.trim() : ''
    if (!rootPath) return c.json({ error: 'path required' }, 400)
    try {
      const inserted = await deps.pool.query<{ id: string; path: string }>(
        `INSERT INTO library_roots (path) VALUES ($1) RETURNING id::text AS id, path`,
        [rootPath],
      )
      const row = inserted.rows[0]
      if (!row) return c.json({ error: 'root missing after insert' }, 500)
      return c.json(row)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
  })

  app.delete('/api/library/roots/:id', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    const deleted = await deps.pool.query(`DELETE FROM library_roots WHERE id = $1::bigint`, [id])
    if ((deleted.rowCount ?? 0) === 0) return c.json({ error: 'not found' }, 404)
    return c.body(null, 204)
  })

  app.post('/api/library/scan', async (c) => {
    const job = await enqueueScan(deps)
    return c.json(job)
  })

  app.post('/api/cache/songs/:id', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    const found = await deps.pool.query(`SELECT 1 FROM songs WHERE id = $1::bigint`, [id])
    if ((found.rowCount ?? 0) === 0) return c.json({ error: 'not found' }, 404)
    const job = await enqueueCacheSong(deps, id, false)
    return c.json(job)
  })

  app.post('/api/cache/playlists/:id', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    const found = await deps.pool.query(`SELECT 1 FROM playlists WHERE id = $1::bigint`, [id])
    if ((found.rowCount ?? 0) === 0) return c.json({ error: 'not found' }, 404)
    const job = await enqueueCachePlaylist(deps, id)
    return c.json(job)
  })

  app.post('/api/cache/songs/:id/recache', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    const found = await deps.pool.query(`SELECT 1 FROM songs WHERE id = $1::bigint`, [id])
    if ((found.rowCount ?? 0) === 0) return c.json({ error: 'not found' }, 404)
    const job = await enqueueCacheSong(deps, id, true)
    return c.json(job)
  })

  app.get('/api/jobs/:id', async (c) => {
    const id = c.req.param('id')
    if (!isLibraryId(id)) return c.json({ error: 'not found' }, 404)
    const found = await deps.pool.query(
      `SELECT id::text AS id, kind, status, payload, result, error_summary,
              started_at, finished_at, created_at
       FROM jobs WHERE id = $1::bigint`,
      [id],
    )
    const row = found.rows[0]
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json(row)
  })

  app.get('/api/settings', async (c) => {
    return c.json(await settingsPayload(deps))
  })

  app.put('/api/settings', async (c) => {
    const body = await readJson(c)
    const partial: Record<string, string> = {}
    let password: string | undefined

    if (typeof body.quality === 'string') {
      const quality = parseQualityInput(body.quality.trim())
      if (quality) partial.quality = quality
    }
    if (typeof body.sourceOrder === 'string') {
      const order = parseSourceOrderInput(body.sourceOrder)
      if (order) partial.sourceOrder = order
    }
    if (body.scheduleOn === '0' || body.scheduleOn === '1') partial.scheduleOn = body.scheduleOn
    if (typeof body.schedule === 'string') partial.schedule = body.schedule
    if (typeof body.scheduleTime === 'string') partial.scheduleTime = body.scheduleTime
    if (typeof body.cron === 'string') partial.cron = body.cron
    if (body.scanWithSchedule === '0' || body.scanWithSchedule === '1') {
      partial.scanWithSchedule = body.scanWithSchedule
    }
    if (typeof body.subsonicUser === 'string') partial.subsonicUser = body.subsonicUser
    if (typeof body.subsonicPassword === 'string' && body.subsonicPassword.length > 0) {
      password = body.subsonicPassword
    }

    if (cronWouldBeInvalid(deps.cronSnapshot, partial)) {
      return c.json({ error: 'invalid cron' }, 400)
    }

    for (const [key, value] of Object.entries(partial)) {
      await writeSetting(deps.pool, key, value)
    }
    if (password !== undefined) {
      await setSubsonicPassword(deps.dataDir, deps.pool, password)
    }
    applyCronSnapshot(deps.cronSnapshot, partial)
    if (
      'scheduleOn' in partial
      || 'schedule' in partial
      || 'scheduleTime' in partial
      || 'cron' in partial
      || 'scanWithSchedule' in partial
    ) {
      deps.rescheduleCron?.()
    }
    return c.json(await settingsPayload(deps))
  })
}
