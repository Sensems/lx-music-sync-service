import { createCipheriv, createHash, constants, publicEncrypt, randomBytes } from 'node:crypto'
import vm from 'node:vm'
import zlib from 'node:zlib'
import needle from 'needle'
import type { MusicInfo, Quality } from '../types.js'
import { parseScriptInfo } from './parseScript.js'

export type SourceStatus = {
  ok: boolean
  message: string
  name?: string
  version?: string
  sources: Record<string, { actions: string[]; qualitys: string[] }>
}

type RequestHandler = (data: {
  source: string
  action: string
  info: { type: Quality; musicInfo: MusicInfo }
}) => Promise<unknown> | unknown

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const

const eventNames = Object.values(EVENT_NAMES)

const allSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'local'] as const

const supportQualitys: Record<(typeof allSources)[number], string[]> = {
  kw: ['128k', '320k', 'flac', 'flac24bit'],
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  mg: ['128k', '320k', 'flac', 'flac24bit'],
  local: [],
}

const supportActions: Record<string, string[]> = {
  kw: ['musicUrl'],
  kg: ['musicUrl'],
  tx: ['musicUrl'],
  wy: ['musicUrl'],
  mg: ['musicUrl'],
  xm: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
}

const GET_MUSIC_URL_TIMEOUT_MS = 20_000
const SCRIPT_TIMEOUT_MS = 5_000

type InitInfo = {
  sources?: Record<string, { type?: string; actions?: string[]; qualitys?: string[] }>
}

const filterSources = (info: InitInfo | null | undefined): SourceStatus['sources'] => {
  if (!info) throw new Error('Missing required parameter init info')

  const sources: SourceStatus['sources'] = {}
  for (const source of allSources) {
    const userSource = info.sources?.[source]
    if (!userSource || userSource.type !== 'music') continue
    const qualitys = supportQualitys[source]
    const actions = supportActions[source] ?? []
    sources[source] = {
      actions: actions.filter(a => (userSource.actions ?? []).includes(a)),
      qualitys: qualitys.filter(q => (userSource.qualitys ?? []).includes(q)),
    }
  }
  return sources
}

const createLxUtils = () => ({
  crypto: {
    aesEncrypt(buffer: Buffer | string, mode: string, key: Buffer | string, iv: Buffer | string) {
      const cipher = createCipheriv(mode, key, iv)
      return Buffer.concat([cipher.update(buffer), cipher.final()])
    },
    rsaEncrypt(buffer: Buffer, key: string | Buffer) {
      const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
      return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, padded)
    },
    randomBytes(size: number) {
      return randomBytes(size)
    },
    md5(str: string | Buffer) {
      return createHash('md5').update(str).digest('hex')
    },
  },
  buffer: {
    from(...args: unknown[]) {
      return (Buffer.from as (...a: unknown[]) => Buffer)(...args)
    },
    bufToString(buf: string | Buffer, format?: BufferEncoding) {
      return Buffer.from(buf as string, 'binary').toString(format)
    },
  },
  zlib: {
    inflate(buf: zlib.InputType) {
      return new Promise<Buffer>((resolve, reject) => {
        zlib.inflate(buf, (err, data) => {
          if (err) reject(new Error(err.message))
          else resolve(data)
        })
      })
    },
    deflate(data: zlib.InputType) {
      return new Promise<Buffer>((resolve, reject) => {
        zlib.deflate(data, (err, buf) => {
          if (err) reject(new Error(err.message))
          else resolve(buf)
        })
      })
    },
  },
})

type LxRequestOptions = {
  method?: string
  timeout?: number
  headers?: Record<string, string>
  body?: unknown
  form?: unknown
  formData?: unknown
}

type AbortableRequest = { aborted?: boolean; abort: () => void }

const lxRequest = (
  url: string,
  { method = 'get', timeout, headers, body, form, formData }: LxRequestOptions = {},
  callback?: (err: Error | null, resp: unknown, body: unknown) => void,
) => {
  const options: needle.NeedleOptions = { headers }
  let data: needle.BodyData = null
  if (body) {
    data = body as needle.BodyData
  } else if (form) {
    data = form as needle.BodyData
    options.json = false
  } else if (formData) {
    data = formData as needle.BodyData
    options.json = false
  }
  options.response_timeout = typeof timeout == 'number' && timeout > 0 ? Math.min(timeout, 60_000) : 60_000

  const stream = needle.request(
    method as needle.NeedleHttpVerbs,
    url,
    data,
    options,
    (err, resp) => {
      try {
        if (err) {
          callback?.(err, null, null)
        } else {
          let parsedBody: unknown = resp.raw.toString()
          resp.body = parsedBody
          try {
            resp.body = JSON.parse(parsedBody as string)
          } catch (_) {}
          parsedBody = resp.body
          callback?.(err, {
            statusCode: resp.statusCode,
            statusMessage: resp.statusMessage,
            headers: resp.headers,
            bytes: resp.bytes,
            raw: resp.raw,
            body: parsedBody,
          }, parsedBody)
        }
      } catch (callbackErr) {
        const message = callbackErr instanceof Error ? callbackErr.message : String(callbackErr)
        callback?.(new Error(message), null, null)
      }
    },
  ) as NodeJS.ReadableStream & { request?: AbortableRequest }

  let request: AbortableRequest | null | undefined = stream.request

  return () => {
    if (request && !request.aborted) request.abort()
    request = null
  }
}

export function createUserApiRuntime(): {
  load(script: string): Promise<SourceStatus>
  getMusicUrl(source: string, musicInfo: MusicInfo, quality: Quality): Promise<{ type: Quality; url: string }>
  dispose(): void
} {
  let requestHandler: RequestHandler | null = null
  let disposed = false

  const dispose = () => {
    disposed = true
    requestHandler = null
  }

  const load = async (script: string): Promise<SourceStatus> => {
    if (disposed) throw new Error('Runtime disposed')
    requestHandler = null

    let scriptInfo: ReturnType<typeof parseScriptInfo>
    try {
      scriptInfo = parseScriptInfo(script)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, message, sources: {} }
    }

    let settled = false
    let resolveStatus!: (status: SourceStatus) => void
    const statusPromise = new Promise<SourceStatus>((resolve) => {
      resolveStatus = resolve
    })

    const finish = (status: SourceStatus) => {
      if (settled) return
      settled = true
      resolveStatus(status)
    }

    let isInitedApi = false
    let isShowedUpdateAlert = false

    const lx = {
      EVENT_NAMES,
      env: 'desktop' as const,
      version: '2.0.0',
      currentScriptInfo: {
        name: scriptInfo.name,
        description: scriptInfo.description,
        version: scriptInfo.version,
        author: scriptInfo.author,
        homepage: scriptInfo.homepage,
        rawScript: script,
      },
      request: lxRequest,
      utils: createLxUtils(),
      send(eventName: string, data?: InitInfo & { log?: string; updateUrl?: string }) {
        return new Promise<void>((resolve, reject) => {
          if (!eventNames.includes(eventName as (typeof eventNames)[number])) {
            return reject(new Error('The event is not supported: ' + eventName))
          }
          switch (eventName) {
            case EVENT_NAMES.inited: {
              if (isInitedApi) return reject(new Error('Script is inited'))
              isInitedApi = true
              try {
                const sources = filterSources(data)
                finish({
                  ok: true,
                  message: '',
                  name: scriptInfo.name,
                  version: scriptInfo.version,
                  sources,
                })
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                finish({
                  ok: false,
                  message,
                  name: scriptInfo.name,
                  version: scriptInfo.version,
                  sources: {},
                })
              }
              resolve()
              break
            }
            case EVENT_NAMES.updateAlert: {
              if (isShowedUpdateAlert) return reject(new Error('The update alert can only be called once.'))
              isShowedUpdateAlert = true
              resolve()
              break
            }
            default:
              reject(new Error('Unknown event name: ' + eventName))
          }
        })
      },
      on(eventName: string, handler: RequestHandler) {
        if (!eventNames.includes(eventName as (typeof eventNames)[number])) {
          return Promise.reject(new Error('The event is not supported: ' + eventName))
        }
        switch (eventName) {
          case EVENT_NAMES.request:
            requestHandler = handler
            break
          default:
            return Promise.reject(new Error('The event is not supported: ' + eventName))
        }
        return Promise.resolve()
      },
    }

    const ctx = vm.createContext({ lx, console })
    try {
      vm.runInContext(script, ctx, { timeout: SCRIPT_TIMEOUT_MS })
      if (!settled) {
        finish({
          ok: false,
          message: 'Missing required parameter init info',
          name: scriptInfo.name,
          version: scriptInfo.version,
          sources: {},
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finish({
        ok: false,
        message,
        name: scriptInfo.name,
        version: scriptInfo.version,
        sources: {},
      })
    }

    return statusPromise
  }

  const getMusicUrl = async (
    source: string,
    musicInfo: MusicInfo,
    quality: Quality,
  ): Promise<{ type: Quality; url: string }> => {
    if (disposed) throw new Error('Runtime disposed')
    if (!requestHandler) throw new Error('Request event is not defined')

    const handler = requestHandler
    const response = await Promise.race([
      Promise.resolve(handler({
        source,
        action: 'musicUrl',
        info: { type: quality, musicInfo },
      })),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), GET_MUSIC_URL_TIMEOUT_MS)
      }),
    ])

    if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) {
      throw new Error('failed')
    }

    return { type: quality, url: response }
  }

  return { load, getMusicUrl, dispose }
}
