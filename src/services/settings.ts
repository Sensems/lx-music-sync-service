import type { createRepos } from '../db/repos.js'
import { proxyFromSettings } from '../sdk/proxy.js'
import type { SourceStatus } from '../userApi/runtime.js'

type Repos = ReturnType<typeof createRepos>

export type SettingsRuntime = {
  getStatus(): SourceStatus
  setProxy(proxy: { host: string; port: number } | null): void
}

const SETTINGS_WRITABLE = new Set([
  'savePath',
  'quality',
  'scheduleOn',
  'schedule',
  'scheduleTime',
  'cron',
  'concurrency',
  'fileName',
  'proxyOn',
  'proxyHost',
  'proxyPort',
])

export function settingsWithSource(repos: Repos, runtime: SettingsRuntime) {
  const settings = repos.settings.getAll()
  const status = runtime.getStatus()
  return {
    ...settings,
    name: status.name ?? '',
    version: status.version ?? '',
    sourceOk: status.ok,
    sourceMessage: status.message,
  }
}

export function applyProxyFromSettings(repos: Repos, runtime: SettingsRuntime) {
  runtime.setProxy(proxyFromSettings(repos.settings.getAll()))
}

export type SettingsService = {
  get(): ReturnType<typeof settingsWithSource>
  put(body: Record<string, unknown>): ReturnType<typeof settingsWithSource>
}

/** Write settings, refresh proxy from saved values, then reschedule cron when provided. */
export function createSettingsService(opts: {
  repos: Repos
  runtime: SettingsRuntime
  rescheduleCron?: () => void
}): SettingsService {
  const { repos, runtime } = opts

  return {
    get() {
      return settingsWithSource(repos, runtime)
    },

    put(body: Record<string, unknown>) {
      const partial: Record<string, string> = {}
      for (const [key, value] of Object.entries(body)) {
        if (!SETTINGS_WRITABLE.has(key)) continue
        if (value === undefined || value === null) continue
        partial[key] = String(value)
      }
      if (Object.keys(partial).length) {
        repos.settings.setMany(partial)
      }
      if ('proxyOn' in partial || 'proxyHost' in partial || 'proxyPort' in partial) {
        applyProxyFromSettings(repos, runtime)
      }
      if (
        'scheduleOn' in partial ||
        'schedule' in partial ||
        'scheduleTime' in partial ||
        'cron' in partial
      ) {
        opts.rescheduleCron?.()
      }
      return settingsWithSource(repos, runtime)
    },
  }
}
