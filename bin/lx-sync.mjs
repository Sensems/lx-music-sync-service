#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'tsx/esm/api'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 在同一个进程里运行 TypeScript，而不是 spawn 子进程：这样 PM2 / systemd
// 发来的 SIGINT、SIGTERM 才能真正关掉 HTTP 服务，否则重启后会留下占着端口的孤儿进程。
process.chdir(root)
register()

const { createDefaultCliDeps, runCli } = await import(pathToFileURL(join(root, 'src', 'cli.ts')).href)
const code = await runCli(process.argv.slice(2), await createDefaultCliDeps())
process.exit(code)
