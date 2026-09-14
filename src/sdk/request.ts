import { deflateRaw } from 'node:zlib'
import needle from 'needle'
import { httpOverHttp, httpsOverHttp } from 'tunnel'
import { getSdkProxy } from './proxy.js'
import { bHh } from './musicSdk/options.js'

const httpsRxp = /^https:/

const defaultHeaders: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

const requestMsg = {
  cancelRequest: 'Cancel request',
  unachievable: 'Unachievable',
  timeout: 'Request timeout',
  notConnectNetwork: 'Not connect network',
}

if (!(process.versions as any).app) {
  ;(process.versions as any).app = '2.12.0'
}

const getRequestAgent = (url: string) => {
  const proxy = getSdkProxy()
  if (!proxy) return undefined
  const options = { proxy: { host: proxy.host, port: proxy.port } }
  return httpsRxp.test(url) ? httpsOverHttp(options) : httpOverHttp(options)
}

type NeedleOpts = needle.NeedleOptions & {
  body?: unknown
  form?: unknown
  formData?: unknown
  timeout?: number
  json?: boolean
  method?: string
  headers?: Record<string, string>
  format?: string
}

const request = (
  url: string,
  options: NeedleOpts,
  callback: (err: Error | null, resp: needle.NeedleResponse | null, body?: unknown) => void,
) => {
  let data: unknown
  if (options.body) {
    data = options.body
  } else if (options.form) {
    data = options.form
    options.json = false
  } else if (options.formData) {
    data = options.formData
    options.json = false
  }
  options.response_timeout = options.timeout

  return needle.request(options.method || 'get', url, data as any, options, (err, resp, body) => {
    if (!err && resp) {
      body = resp.body = resp.raw.toString()
      try {
        resp.body = JSON.parse(resp.body as string)
      } catch {
        /* keep string body */
      }
      body = resp.body
    }
    callback(err, resp ?? null, body)
  }).request
}

export const cancelHttp = (requestObj: { abort?: () => void } | null | undefined) => {
  if (!requestObj?.abort) return
  requestObj.abort()
}

const handleDeflateRaw = (data: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    deflateRaw(data, (err, buf) => {
      if (err) return reject(err)
      resolve(buf)
    })
  })

const regx = /(?:\d\w)+/g

const fetchData = async (
  url: string,
  method: string,
  {
    headers = {},
    format = 'json',
    timeout = 15000,
    ...options
  }: NeedleOpts,
  callback: (err: Error | null, resp: needle.NeedleResponse | null, body?: unknown) => void,
) => {
  headers = Object.assign({}, headers)
  if ((headers as any)[bHh]) {
    const path = url.replace(/^https?:\/\/[\w.:]+\//, '/')
    let s = Buffer.from(bHh, 'hex').toString()
    s = s.replace(s.substring(s.length - 1), '')
    s = Buffer.from(s, 'base64').toString()
    const appVer = String((process.versions as any).app || '2.12.0')
    const v = appVer
      .split('-')[0]!
      .split('.')
      .map(n => (n.length < 3 ? n.padStart(3, '0') : n))
      .join('')
    const v2 = appVer.split('-')[1] || ''
    ;(headers as any)[s] =
      !s ||
      `${(
        await handleDeflateRaw(
          Buffer.from(
            JSON.stringify(`${path}${v}`.match(regx), null, 1).concat(v),
          ).toString('base64'),
        )
      ).toString('hex')}&${parseInt(v, 10)}${v2}`
    delete (headers as any)[bHh]
  }
  return request(
    url,
    {
      ...options,
      method,
      headers: Object.assign({}, defaultHeaders, headers),
      timeout,
      agent: getRequestAgent(url),
      json: format === 'json',
    },
    (err, resp, body) => {
      if (err) return callback(err, null)
      callback(null, resp, body)
    },
  )
}

type HttpFetchObj = {
  isCancelled: boolean
  requestObj: { abort?: () => void } | null
  promise: Promise<needle.NeedleResponse>
  cancelHttp: () => void
  cancelFn: ((err: Error) => void) | null
}

const buildHttpPromise = (url: string, options: NeedleOpts): HttpFetchObj => {
  const obj: HttpFetchObj = {
    isCancelled: false,
    requestObj: null,
    cancelFn: null,
    cancelHttp: () => {
      if (!obj.requestObj) {
        obj.isCancelled = true
        return
      }
      cancelHttp(obj.requestObj)
      obj.requestObj = null
      obj.cancelFn?.(new Error(requestMsg.cancelRequest))
      obj.cancelFn = null
    },
    promise: null as unknown as Promise<needle.NeedleResponse>,
  }
  obj.promise = new Promise((resolve, reject) => {
    obj.cancelFn = reject
    fetchData(url, options.method || 'get', options, (err, resp) => {
      obj.requestObj = null
      obj.cancelFn = null
      if (err) return reject(err)
      resolve(resp!)
    }).then(ro => {
      obj.requestObj = ro
      if (obj.isCancelled) obj.cancelHttp()
    })
  })
  return obj
}

/** Align with desktop httpFetch: returns { promise, cancelHttp }. */
export const httpFetch = (url: string, options: NeedleOpts = { method: 'get' }) => {
  const requestObj = buildHttpPromise(url, options)
  requestObj.promise = requestObj.promise.catch(err => {
    if (err.message === 'socket hang up') {
      return Promise.reject(new Error(requestMsg.unachievable))
    }
    switch (err.code) {
      case 'ETIMEDOUT':
      case 'ESOCKETTIMEDOUT':
        return Promise.reject(new Error(requestMsg.timeout))
      case 'ENOTFOUND':
        return Promise.reject(new Error(requestMsg.notConnectNetwork))
      default:
        return Promise.reject(err)
    }
  }) as Promise<needle.NeedleResponse>
  return requestObj
}

export default { httpFetch, cancelHttp }
