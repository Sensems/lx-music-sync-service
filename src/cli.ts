import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command, CommanderError } from 'commander'
import type { createRepos } from './db/repos.js'
import type { AppCtx } from './http/app.js'
import type { MusicInfo, OnlineSource } from './types.js'

type Repos = ReturnType<typeof createRepos>

export type CliDeps = Pick<AppCtx, 'repos' | 'sync' | 'search'> & {
  log: (line: string) => void
  error: (line: string) => void
  startServe?: (opts: { static: boolean; cron: boolean }) => Promise<void>
}

function musicInfoFromDownloadOpts(source: string, id: string): MusicInfo {
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

function buildProgram(deps: CliDeps): Command {
  const program = new Command('lx-sync')
  program.exitOverride()
  program.configureOutput({
    writeOut: str => {
      const t = str.replace(/\n$/, '')
      if (t) deps.log(t)
    },
    writeErr: str => {
      const t = str.replace(/\n$/, '')
      if (t) deps.error(t)
    },
  })

  const playlist = program.command('playlist').description('Manage playlists')

  playlist
    .command('add')
    .description('Add a playlist subscription')
    .requiredOption('--source <source>', 'online source (kw, kg, tx, wy, mg)')
    .requiredOption('--url <url>', 'playlist URL')
    .action(async opts => {
      const row = deps.repos.playlists.insert({
        source: opts.source as OnlineSource,
        url: String(opts.url),
      })
      deps.log(JSON.stringify(row))
    })

  playlist
    .command('list')
    .description('List playlists')
    .action(() => {
      deps.log(JSON.stringify({ list: deps.repos.playlists.list() }))
    })

  playlist
    .command('remove <id>')
    .description('Remove a playlist by id')
    .action((id: string) => {
      const num = Number(id)
      if (!Number.isFinite(num) || !deps.repos.playlists.get(num)) {
        deps.error('not found')
        throw new CommanderError(1, 'playlist.remove', 'not found')
      }
      deps.repos.playlists.remove(num)
    })

  program
    .command('sync')
    .description('Sync playlists')
    .option('--id <id>', 'sync one playlist', (v: string) => Number(v))
    .action(async opts => {
      const job =
        opts.id != null && Number.isFinite(opts.id)
          ? await deps.sync.syncPlaylist(opts.id)
          : await deps.sync.syncAll()
      deps.log(JSON.stringify(job))
    })

  program
    .command('search')
    .description('Search music')
    .requiredOption('--source <source>', 'source or all')
    .requiredOption('--q <text>', 'search query')
    .action(async opts => {
      const source = String(opts.source) as OnlineSource | 'all'
      const q = String(opts.q)
      const result = await deps.search.searchMusic(source, q, 1)
      deps.log(JSON.stringify(result))
    })

  program
    .command('download')
    .description('Download a track from search')
    .requiredOption('--source <source>', 'online source')
    .requiredOption('--id <id>', 'platform song id')
    .action(async opts => {
      const musicInfo = musicInfoFromDownloadOpts(String(opts.source), String(opts.id))
      try {
        const row = await deps.sync.downloadSearch(musicInfo)
        deps.log(JSON.stringify(row))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        deps.error(message)
        throw new CommanderError(1, 'download', message)
      }
    })

  program
    .command('serve')
    .description('Start HTTP API server')
    .action(async () => {
      if (!deps.startServe) {
        deps.error('not implemented')
        throw new CommanderError(2, 'serve', 'not implemented')
      }
      await deps.startServe({ static: true, cron: true })
    })

  return program
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const program = buildProgram(deps)
  try {
    await program.parseAsync(argv, { from: 'user' })
    return 0
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
        return 0
      }
      return err.exitCode ?? 1
    }
    const message = err instanceof Error ? err.message : String(err)
    deps.error(message)
    return 1
  }
}

export async function createDefaultCliDeps(): Promise<CliDeps> {
  const { createAppContext, startServe } = await import('./serve.js')
  const ctx = await createAppContext()
  return {
    repos: ctx.repos,
    sync: ctx.sync,
    search: ctx.search,
    log: line => {
      if (line) console.log(line)
    },
    error: line => {
      if (line) console.error(line)
    },
    startServe,
  }
}

function isCliMain(): boolean {
  const entry = resolve(fileURLToPath(import.meta.url))
  const arg = process.argv[1]
  if (!arg) return false
  return resolve(arg) === entry || arg.replace(/\\/g, '/').endsWith('src/cli.ts')
}

if (isCliMain()) {
  const code = await runCli(process.argv.slice(2), await createDefaultCliDeps())
  process.exit(code)
}
