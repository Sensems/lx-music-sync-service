import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type AppConfig = {
  host: string
  port: number
  dataDir: string
  logLevel: string
}

const DEFAULTS: AppConfig = {
  host: '127.0.0.1',
  port: 8787,
  dataDir: './data',
  logLevel: 'info',
}

export type LoadConfigOptions = {
  /** Override path; otherwise TINGGUI_CONFIG or ./config.yaml */
  configPath?: string
  cwd?: string
}

export function loadConfig(opts: LoadConfigOptions = {}): AppConfig {
  const cwd = opts.cwd ?? process.cwd()
  const path =
    opts.configPath ??
    process.env.TINGGUI_CONFIG ??
    resolve(cwd, 'config.yaml')

  let fileCfg: Partial<AppConfig> = {}
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8')
    const parsed = parseYaml(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fileCfg = parsed as Partial<AppConfig>
    }
  }

  const portRaw = fileCfg.port ?? DEFAULTS.port
  const port = typeof portRaw === 'number' ? portRaw : Number(portRaw)

  return {
    host: String(fileCfg.host ?? DEFAULTS.host),
    port: Number.isFinite(port) && port > 0 ? port : DEFAULTS.port,
    dataDir: String(fileCfg.dataDir ?? DEFAULTS.dataDir),
    logLevel: String(fileCfg.logLevel ?? DEFAULTS.logLevel),
  }
}
