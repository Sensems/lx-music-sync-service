import { createWriteStream, existsSync, openSync, readSync, statSync, unlinkSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { httpOverHttp, httpsOverHttp } from 'tunnel'
import { getSdkProxy } from '../sdk/proxy.js'

const TAIL_LEN = 10

export type DownloadProgress = { downloaded: number; total: number | null }

export type DownloadFileOptions = {
  url: string
  destPath: string
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
}

function getRequestAgent(url: string): http.Agent | https.Agent | undefined {
  const proxy = getSdkProxy()
  if (!proxy) return undefined
  const options = { proxy: { host: proxy.host, port: proxy.port } }
  return /^https:/.test(url) ? httpsOverHttp(options) : httpOverHttp(options)
}

function requestModule(url: string): typeof http | typeof https {
  return /^https:/.test(url) ? https : http
}

function parseTotalFromHeaders(
  statusCode: number,
  headers: http.IncomingHttpHeaders,
  resumeFrom: number,
): number | null {
  const cr = headers['content-range']
  if (typeof cr === 'string') {
    const m = /\/(\d+|\*)\s*$/.exec(cr)
    if (m && m[1] !== '*') return Number(m[1])
  }
  const len = headers['content-length']
  if (len != null) {
    const chunk = Number(len)
    if (Number.isFinite(chunk)) {
      if (statusCode === 206 && resumeFrom > 0) return resumeFrom + chunk
      return chunk
    }
  }
  return null
}

async function finishDownload(partPath: string, destPath: string): Promise<void> {
  if (existsSync(destPath)) {
    await unlink(partPath).catch(() => {})
    return
  }
  await rename(partPath, destPath)
}

function prepareResume(partPath: string): { rangeStart: number; tail: Buffer | null; downloaded: number } {
  if (!existsSync(partPath)) {
    return { rangeStart: 0, tail: null, downloaded: 0 }
  }
  const size = statSync(partPath).size
  if (size >= TAIL_LEN) {
    const fd = openSync(partPath, 'r')
    const tail = Buffer.alloc(TAIL_LEN)
    readSync(fd, tail, 0, TAIL_LEN, size - TAIL_LEN)
    return { rangeStart: size - TAIL_LEN, tail, downloaded: size }
  }
  if (size > 0) {
    unlinkSync(partPath)
  }
  return { rangeStart: 0, tail: null, downloaded: 0 }
}

function fetchOnce(
  url: string,
  rangeStart: number,
  signal?: AbortSignal,
): Promise<{ res: http.IncomingMessage; resumeFrom: number }> {
  return new Promise((resolve, reject) => {
    const mod = requestModule(url)
    const headers: Record<string, string> = {}
    if (rangeStart > 0) headers.Range = `bytes=${rangeStart}-`

    const req = mod.get(
      url,
      { agent: getRequestAgent(url), headers, signal },
      res => {
        if (res.statusCode === 416) {
          res.resume()
          reject(Object.assign(new Error('Range Not Satisfiable'), { statusCode: 416 }))
          return
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        resolve({ res, resumeFrom: rangeStart > 0 && res.statusCode === 206 ? rangeStart : 0 })
      },
    )
    req.on('error', reject)
    signal?.addEventListener(
      'abort',
      () => {
        req.destroy()
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      },
      { once: true },
    )
  })
}

async function streamToPart(
  res: http.IncomingMessage,
  partPath: string,
  opts: {
    append: boolean
    tail: Buffer | null
    downloaded: number
    total: number | null
    onProgress?: (p: DownloadProgress) => void
    signal?: AbortSignal
  },
): Promise<{ mismatch: boolean }> {
  let pendingTail = opts.tail
  let downloaded = opts.downloaded
  opts.onProgress?.({ downloaded, total: opts.total })

  const ws = createWriteStream(partPath, { flags: opts.append ? 'a' : 'w' })

  return new Promise((resolve, reject) => {
    const cleanup = (err?: Error) => {
      res.destroy()
      ws.destroy()
      if (err) reject(err)
    }

    signalAbort(opts.signal, () => cleanup(Object.assign(new Error('aborted'), { name: 'AbortError' })))

    res.on('data', (chunk: Buffer) => {
      if (opts.signal?.aborted) return
      let toWrite = chunk
      if (pendingTail) {
        const tailLen = pendingTail.length
        const chunkLen = chunk.length
        if (chunkLen >= tailLen) {
          if (!chunk.subarray(0, tailLen).equals(pendingTail)) {
            ws.close(() => resolve({ mismatch: true }))
            res.destroy()
            return
          }
          pendingTail = null
          toWrite = chunk.subarray(tailLen)
          if (toWrite.length === 0) return
        } else {
          if (!chunk.equals(pendingTail.subarray(0, chunkLen))) {
            ws.close(() => resolve({ mismatch: true }))
            res.destroy()
            return
          }
          pendingTail = pendingTail.subarray(chunkLen)
          return
        }
      }
      downloaded += toWrite.length
      opts.onProgress?.({ downloaded, total: opts.total })
      if (!ws.write(toWrite)) {
        res.pause()
        ws.once('drain', () => res.resume())
      }
    })

    res.on('error', err => cleanup(err))
    ws.on('error', err => cleanup(err))
    res.on('end', () => {
      ws.end(() => {
        if (pendingTail) {
          resolve({ mismatch: true })
          return
        }
        resolve({ mismatch: false })
      })
    })
  })
}

function signalAbort(signal: AbortSignal | undefined, onAbort: () => void) {
  if (!signal) return
  if (signal.aborted) {
    onAbort()
    return
  }
  signal.addEventListener('abort', onAbort, { once: true })
}

export async function downloadFile(opts: DownloadFileOptions): Promise<void> {
  const partPath = opts.destPath + '.part'
  let { rangeStart, tail, downloaded } = prepareResume(partPath)

  for (let attempt = 0; attempt < 4; attempt++) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }

    let res: http.IncomingMessage
    let resumeFrom: number
    try {
      ;({ res, resumeFrom } = await fetchOnce(opts.url, rangeStart, opts.signal))
    } catch (err: unknown) {
      const e = err as { statusCode?: number }
      if (e.statusCode === 416 && existsSync(partPath)) {
        await unlink(partPath).catch(() => {})
        rangeStart = 0
        tail = null
        downloaded = 0
        continue
      }
      throw err
    }

    const total = parseTotalFromHeaders(res.statusCode ?? 0, res.headers, resumeFrom)
    const append = rangeStart > 0 && tail !== null
    const { mismatch } = await streamToPart(res, partPath, {
      append,
      tail,
      downloaded,
      total,
      onProgress: opts.onProgress,
      signal: opts.signal,
    })

    if (mismatch) {
      await unlink(partPath).catch(() => {})
      rangeStart = 0
      tail = null
      downloaded = 0
      continue
    }

    await finishDownload(partPath, opts.destPath)
    return
  }

  throw new Error('download failed after retries')
}
