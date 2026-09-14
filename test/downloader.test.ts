import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadFile } from '../src/download/downloader.js'

describe('downloadFile resume', () => {
  it('resumes with last-10-byte check', async () => {
    const payload = Buffer.alloc(64, 7)
    const ranges: string[] = []
    const server = createServer((req, res) => {
      ranges.push(String(req.headers.range || ''))
      const buf = payload
      if (req.headers.range) {
        const m = /bytes=(\d+)-/.exec(String(req.headers.range))
        const start = Number(m?.[1] || 0)
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${buf.length - 1}/${buf.length}`)
        res.end(buf.subarray(start))
      } else {
        res.end(buf)
      }
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as { port: number }).port
    const dir = mkdtempSync(join(tmpdir(), 'dl-'))
    const dest = join(dir, 'a.bin')
    writeFileSync(dest + '.part', payload.subarray(0, 20))
    await downloadFile({ url: `http://127.0.0.1:${port}/f`, destPath: dest })
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(existsSync(dest + '.part')).toBe(false)
    expect(ranges.some(r => r.includes('bytes=10-'))).toBe(true)
    server.close()
  })

  it('rewrites part when tail mismatches', async () => {
    const payload = Buffer.alloc(32, 1)
    const server = createServer((_req, res) => res.end(payload))
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as { port: number }).port
    const dest = join(mkdtempSync(join(tmpdir(), 'dl-')), 'b.bin')
    writeFileSync(dest + '.part', Buffer.alloc(20, 9))
    await downloadFile({ url: `http://127.0.0.1:${port}/f`, destPath: dest })
    expect(readFileSync(dest).equals(payload)).toBe(true)
    server.close()
  })
})
