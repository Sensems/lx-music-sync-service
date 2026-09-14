import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve as honoServe } from '@hono/node-server'
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
  const withStatic = opts.static ?? false
  const withCron = opts.cron ?? false
  if (withStatic || withCron) {
    throw new Error('static/cron not implemented yet')
  }

  const config = loadConfig()
  const ctx = await createAppContext(config)
  const app = createApp(ctx)

  honoServe(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    },
    info => {
      console.log(`lx-sync listening on http://${config.host}:${info.port}`)
    },
  )
}
