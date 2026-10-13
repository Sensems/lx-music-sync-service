import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command, CommanderError } from 'commander'
import type { MusicInfo, OnlineSource } from './types.js'

export type CliDeps = {
  search: {
    searchMusic(
      source: OnlineSource | 'all',
      q: string,
      page: number,
    ): Promise<{ list: MusicInfo[]; total: number }>
  }
  log: (line: string) => void
  error: (line: string) => void
  startServe?: (opts: { static: boolean; cron: boolean }) => Promise<void>
}

function buildProgram(deps: CliDeps): Command {
  const program = new Command('lx-sync')
  program.exitOverride()
  program.configureOutput({
    writeOut: (str) => {
      const t = str.replace(/\n$/, '')
      if (t) deps.log(t)
    },
    writeErr: (str) => {
      const t = str.replace(/\n$/, '')
      if (t) deps.error(t)
    },
  })

  program
    .command('search')
    .description('Search music')
    .requiredOption('--source <source>', 'source or all')
    .requiredOption('--q <text>', 'search query')
    .action(async (opts) => {
      const source = String(opts.source) as OnlineSource | 'all'
      const q = String(opts.q)
      const result = await deps.search.searchMusic(source, q, 1)
      deps.log(JSON.stringify(result))
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
  // 不在这里开池。serve 自己开一份，避免同一进程连上两次 Postgres。
  let searchCtx: Awaited<ReturnType<typeof createAppContext>> | undefined
  const ensureSearch = async () => {
    searchCtx ??= await createAppContext()
    return searchCtx
  }
  return {
    search: {
      async searchMusic(source, q, page) {
        const ctx = await ensureSearch()
        return ctx.search.searchMusic(source, q, page)
      },
    },
    log: (line) => {
      if (line) console.log(line)
    },
    error: (line) => {
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
