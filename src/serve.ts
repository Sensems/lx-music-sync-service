import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve as honoServe } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import cron from 'node-cron'
import type { Pool } from 'pg'
import { loadConfig, type AppConfig } from './config.js'
import { migrate, openPool } from './db/pg.js'
import { createApp, type AppCtx } from './http/app.js'
import {
  CRON_DEFAULTS,
  enqueueScheduledWork,
  loadCronSnapshot,
  mountManage,
  type ManageCronSnapshot,
  type ManageDeps,
} from './http/manage.js'
import { createJobQueue } from './jobs/queue.js'
import sdk, { createSdkGetListDetail } from './sdk/load.js'
import type { GetListDetail } from './services/playlists.js'
import { createSearchService } from './services/search.js'
import { mountSubsonic } from './subsonic/routes.js'
import type { MusicInfo, Quality } from './types.js'
import { createUserApiRuntime } from './userApi/runtime.js'

export type CronSettings = {
  scheduleOn?: string
  schedule?: string
  cron?: string
  /** HH:mm for daily schedule; default 03:00 */
  scheduleTime?: string
}

export function parseScheduleTime(raw: string | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim())
  if (!m) return { hour: 3, minute: 0 }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 3, minute: 0 }
  }
  return { hour, minute }
}

export function resolveCronExpression(settings: CronSettings): string {
  if (settings.schedule === 'every-6h') return '0 */6 * * *'
  if (settings.schedule === 'daily') {
    const { hour, minute } = parseScheduleTime(settings.scheduleTime)
    return `${minute} ${hour} * * *`
  }
  if (settings.schedule === 'cron' && settings.cron?.trim()) return settings.cron.trim()
  if (settings.cron?.trim()) return settings.cron.trim()
  return '0 */6 * * *'
}

export type CronDeps = {
  getSettings: () => CronSettings
  schedule: (expr: string, fn: () => void) => { stop: () => void } | void
  syncAll: () => Promise<unknown>
}

export type CronHandle = {
  stop: () => void
  reschedule: () => void
}

/** Injectable cron scheduler for tests and serve. Default schedule is OFF. */
export function startCron(deps: CronDeps): CronHandle {
  let task: { stop: () => void } | null = null

  const stop = () => {
    task?.stop()
    task = null
  }

  const reschedule = () => {
    stop()
    const settings = deps.getSettings()
    if (settings.scheduleOn !== '1') return
    const expr = resolveCronExpression(settings)
    const scheduled = deps.schedule(expr, () => {
      void deps.syncAll().catch((err) => {
        console.error('cron sync failed', err)
      })
    })
    if (scheduled && typeof scheduled.stop === 'function') {
      task = scheduled
    }
  }

  reschedule()
  return { stop, reschedule }
}

export type ServeContext = AppCtx & {
  pool: Pool
  cacheDir: string
  search: ReturnType<typeof createSearchService>
  jobs: ReturnType<typeof createJobQueue>
  getListDetail: GetListDetail
  getMusicUrl: (source: string, musicInfo: MusicInfo, quality: Quality) => Promise<{ type: Quality; url: string }>
  cronSnapshot: ManageCronSnapshot
}

export async function createAppContext(config?: AppConfig): Promise<ServeContext> {
  const cfg = config ?? loadConfig()
  const cwd = process.cwd()
  const dataDir = resolve(cwd, cfg.dataDir)
  const cacheDir = join(dataDir, 'cache')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'user-api'), { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  // 曲库在 Postgres。失败就关掉池再抛，避免连接把进程留住。
  const pool = openPool(cfg.databaseUrl)
  try {
    await migrate(pool)
  } catch (err) {
    await pool.end().catch(() => {})
    throw err
  }

  const runtime = createUserApiRuntime()
  const scriptPath = join(dataDir, 'user-api', 'current.js')
  if (existsSync(scriptPath)) {
    await runtime.load(readFileSync(scriptPath, 'utf8'))
  }

  const cronSnapshot: ManageCronSnapshot = { ...CRON_DEFAULTS }
  await loadCronSnapshot(pool, cronSnapshot)

  return {
    dataDir,
    cacheDir,
    runtime: {
      load: (script) => runtime.load(script),
      getStatus: () => runtime.getStatus(),
      setProxy: (proxy) => runtime.setProxy(proxy),
    },
    pool,
    search: createSearchService(sdk),
    jobs: createJobQueue(pool),
    getListDetail: createSdkGetListDetail(),
    getMusicUrl: (source, musicInfo, quality) => runtime.getMusicUrl(source, musicInfo, quality),
    cronSnapshot,
  }
}

export type ServeOptions = {
  static?: boolean
  cron?: boolean
}

export async function startServe(opts: ServeOptions = {}): Promise<void> {
  const withStatic = opts.static ?? true
  const withCron = opts.cron ?? true

  const config = loadConfig()
  const ctx = await createAppContext(config)

  try {
    let cronHandle: CronHandle | null = null
    const manageDeps: ManageDeps = {
      pool: ctx.pool,
      dataDir: ctx.dataDir,
      cacheDir: ctx.cacheDir,
      search: ctx.search,
      getListDetail: ctx.getListDetail,
      getMusicUrl: ctx.getMusicUrl,
      runtime: ctx.runtime,
      jobs: ctx.jobs,
      cronSnapshot: ctx.cronSnapshot,
      rescheduleCron: () => cronHandle?.reschedule(),
    }

    if (withCron) {
      cronHandle = startCron({
        getSettings: () => ctx.cronSnapshot,
        schedule: (expr, fn) => cron.schedule(expr, fn),
        // 定时只排队刷新订阅；扫目录看 scanWithSchedule。不要在定时里缓存。
        syncAll: () => enqueueScheduledWork(manageDeps),
      })
    }

    const app = createApp(ctx)
    mountManage(app, manageDeps)
    // 后面的静态 * 会把没匹配到的 GET 收成网页。Subsonic 要先挂上。
    mountSubsonic(app, {
      dataDir: ctx.dataDir,
      pool: ctx.pool,
      getMusicUrl: ctx.getMusicUrl,
      getStatus: () => ctx.runtime.getStatus(),
    })

    if (withStatic) {
      const distRoot = resolve(process.cwd(), 'web/dist')
      if (!existsSync(distRoot)) {
        console.warn(`web/dist missing at ${distRoot}; run: npm --prefix web run build`)
      }
      app.use(
        '/*',
        serveStatic({
          root: './web/dist',
        }),
      )
      app.get('*', serveStatic({ path: './web/dist/index.html' }))
    }

    const server = honoServe(
      {
        fetch: app.fetch,
        hostname: config.host,
        port: config.port,
      },
      (info) => {
        console.log(`lx-sync listening on http://${config.host}:${info.port}`)
      },
    )

    // Keep the CLI process alive until the HTTP server closes (SIGINT/SIGTERM).
    await new Promise<void>((resolvePromise, reject) => {
      const shutdown = () => {
        cronHandle?.stop()
        server.close((err) => (err ? reject(err) : resolvePromise()))
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
      server.once('error', reject)
    })
  } finally {
    // 池不关的话套接字还在，进程收不到退出。
    await ctx.pool.end().catch(() => {})
  }
}
