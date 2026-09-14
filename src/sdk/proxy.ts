/** Proxy for musicSdk HTTP and user-api lx.request. */

export type SdkProxy = { host: string; port: number }

let settingsProxy: SdkProxy | null | undefined

/** Override used after PUT /api/settings; undefined means fall back to env. */
export function setSdkProxy(proxy: SdkProxy | null | undefined): void {
  settingsProxy = proxy
}

export function getSdkProxy(): SdkProxy | null {
  if (settingsProxy !== undefined) return settingsProxy

  const host = process.env.LX_SDK_PROXY_HOST || process.env.HTTP_PROXY_HOST || ''
  const portRaw = process.env.LX_SDK_PROXY_PORT || process.env.HTTP_PROXY_PORT || ''
  if (!host || !portRaw) return null
  const port = Number(portRaw)
  if (!Number.isFinite(port) || port <= 0) return null
  return { host, port }
}

export function proxyFromSettings(settings: Record<string, string>): SdkProxy | null {
  if (settings.proxyOn !== '1') return null
  const host = settings.proxyHost || ''
  const port = Number(settings.proxyPort || '')
  if (!host || !Number.isFinite(port) || port <= 0) return null
  return { host, port }
}
