#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const entry = join(root, 'src', 'cli.ts')

const result = spawnSync(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
})

process.exit(typeof result.status === 'number' ? result.status : 1)
