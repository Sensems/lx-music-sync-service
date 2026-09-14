import type { Quality } from '../types.js'

export const QUALITYS: Quality[] = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k']

export const getExt = (type: string): 'mp3' | 'flac' | 'wav' | 'ape' => {
  switch (type) {
    case 'ape':
      return 'ape'
    case 'flac':
    case 'flac24bit':
      return 'flac'
    case 'wav':
      return 'wav'
    case '128k':
    case '192k':
    case '320k':
    default:
      return 'mp3'
  }
}

export const pickQuality = (
  wanted: Quality,
  sourceQualities: Quality[],
  songQualities: Partial<Record<Quality, unknown>>,
): Quality => {
  let type = wanted
  if (!sourceQualities.includes(type)) {
    type = sourceQualities[sourceQualities.length - 1]!
  }
  const rangeType = QUALITYS.slice(QUALITYS.indexOf(wanted))
  for (const q of rangeType) {
    if (songQualities[q] && sourceQualities.includes(q)) return q
  }
  return '128k'
}

const unsafeDirChars = /[\\/:*?"<>|]/g

export const safeDirName = (name: string): string => name.replace(unsafeDirChars, '_').trim()

export const formatFileName = (
  pattern: 'name-singer' | 'singer-name' | 'name',
  name: string,
  singer: string,
): string => {
  switch (pattern) {
    case 'name-singer':
      return `${name} - ${singer}`
    case 'singer-name':
      return `${singer} - ${name}`
    case 'name':
      return name
  }
}
