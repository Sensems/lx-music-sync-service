import crypto from 'node:crypto'
import dns from 'node:dns'

/** Helpers formerly from @renderer/utils / @common/utils/common */

export const sizeFormate = (size: number): string => {
  if (!size) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const number = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`
}

const numFix = (n: number): string => (n < 10 ? `0${n}` : n.toString())

export const toDateObj = (date: any): Date | '' => {
  if (!date) return ''
  switch (typeof date) {
    case 'string':
      if (!date.includes('T')) date = date.split('.')[0].replace(/-/g, '/')
    // fallthrough
    case 'number':
      date = new Date(date)
    // fallthrough
    case 'object':
      break
    default:
      return ''
  }
  return date
}

export const dateFormat = (_date: any, format = 'Y-M-D h:m:s') => {
  const date = toDateObj(_date)
  if (!date) return ''
  return format
    .replace('Y', date.getFullYear().toString())
    .replace('M', numFix(date.getMonth() + 1))
    .replace('D', numFix(date.getDate()))
    .replace('h', numFix(date.getHours()))
    .replace('m', numFix(date.getMinutes()))
    .replace('s', numFix(date.getSeconds()))
}

export const formatPlayTime = (time: number) => {
  const m = Math.trunc(time / 60)
  const s = Math.trunc(time % 60)
  return m == 0 && s == 0 ? '--/--' : numFix(m) + ':' + numFix(s)
}

export const formatPlayCount = (num: number): string => {
  if (num > 100000000) return `${Math.trunc(num / 10000000) / 10}亿`
  if (num > 10000) return `${Math.trunc(num / 1000) / 10}万`
  return String(num)
}

const htmlEntities: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

export const decodeName = (str: string | null = '') => {
  if (!str) return ''
  return String(str).replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos);/g, m => htmlEntities[m] ?? m)
}

export const toMD5 = (str: string) => crypto.createHash('md5').update(str).digest('hex')

const ipMap = new Map<string, { address: string; family: number } | true>()

export const getHostIp = (hostname: string) => {
  const result = ipMap.get(hostname)
  if (typeof result === 'object') return result
  if (result === true) return
  ipMap.set(hostname, true)
  dns.lookup(hostname, { all: false }, (err, address, family) => {
    if (err) return
    ipMap.set(hostname, { address, family })
  })
}

export const dnsLookup = (
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => {
  const result = getHostIp(hostname)
  if (result) return callback(null, result.address, result.family)
  dns.lookup(hostname, options, callback)
}

export const formatSingerName = (singers: any, nameKey = 'name', join = '、') => {
  if (Array.isArray(singers)) {
    const singer: string[] = []
    singers.forEach((item: any) => {
      const name = item[nameKey]
      if (!name) return
      singer.push(name)
    })
    return decodeName(singer.join(join))
  }
  return decodeName(String(singers ?? ''))
}
