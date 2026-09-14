/** Proxy for musicSdk HTTP. Task 8 may switch to settings. */
export function getSdkProxy(): { host: string; port: number } | null {
  const host = process.env.LX_SDK_PROXY_HOST || process.env.HTTP_PROXY_HOST || ''
  const portRaw = process.env.LX_SDK_PROXY_PORT || process.env.HTTP_PROXY_PORT || ''
  if (!host || !portRaw) return null
  const port = Number(portRaw)
  if (!Number.isFinite(port) || port <= 0) return null
  return { host, port }
}
