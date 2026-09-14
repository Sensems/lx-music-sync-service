import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve as honoServe } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import cron from 'node-cron'
import { loadConfig, type AppConfig } from './config.js'
import { openDb } from './db/index.js'
import { createRepos } from './db/repos.js'
import { downloadFile } from './download/downloader.js'
import { createApp, type AppCtx } from './http/app.js'
import { proxyFromSettings } from './sdk/proxy.js'
import sdk, { createSdkGetListDetail } from './sdk/load.js'
import { createPlaylistService } from './services/playlists.js'
import { createSearchService } from './services/search.js'
import { createSyncService } from './services/sync.js'
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
      void deps.syncAll().catch(err => {
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

export async function createAppContext(config?: AppConfig): Promise<AppCtx> {
  const cfg = config ?? loadConfig()
  const cwd = process.cwd()
  const dataDir = resolve(cwd, cfg.dataDir)
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'user-api'), { recursive: true })

  const db = openDb(join(dataDir, 'lx-sync.db'))
  const repos = createRepos(db)
  const runtime = createUserApiRuntime()
  runtime.setProxy(proxyFromSettings(repos.settings.getAll()))

  const scriptPath = join(dataDir, 'user-api', 'current.js')
  if (existsSync(scriptPath)) {
    await runtime.load(readFileSync(scriptPath, 'utf8'))
  }

  const getListDetail = createSdkGetListDetail()
  const playlists = createPlaylistService(repos, { getListDetail })
  const sync = createSyncService({
    repos,
    refreshPlaylistSnapshot: playlists.refreshPlaylistSnapshot,
    getMusicUrl: (source, musicInfo, quality) => runtime.getMusicUrl(source, musicInfo, quality),
    getSourceStatus: () => runtime.getStatus(),
    downloadFile,
  })
  const search = createSearchService(sdk)

  return {
    dataDir,
    repos,
    sync,
    playlists: {
      refreshPlaylistSnapshot: id => playlists.refreshPlaylistSnapshot(id),
    },
    search,
    runtime: {
      load: script => runtime.load(script),
      getStatus: () => runtime.getStatus(),
      setProxy: proxy => runtime.setProxy(proxy),
    },
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

  let cronHandle: CronHandle | null = null
  if (withCron) {
    cronHandle = startCron({
      getSettings: () => ctx.repos.settings.getAll(),
      schedule: (expr, fn) => cron.schedule(expr, fn),
      syncAll: () => ctx.sync.syncAll(),
    })
    ctx.rescheduleCron = () => cronHandle?.reschedule()
  }

  const app = createApp(ctx)

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
    info => {
      console.log(`lx-sync listening on http://${config.host}:${info.port}`)
    },
  )

  // Keep the CLI process alive until the HTTP server closes (SIGINT/SIGTERM).
  await new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      cronHandle?.stop()
      server.close(err => (err ? reject(err) : resolve()))
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    server.once('error', reject)
  })
}
