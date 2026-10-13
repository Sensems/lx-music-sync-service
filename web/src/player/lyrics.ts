import type { LyricLine } from './types.js'

const LRC_LINE = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/

function parseTimestamp(min: string, sec: string, frac: string | undefined): number {
  const base = Number(min) * 60 + Number(sec)
  if (!frac) return base
  const denom = frac.length === 2 ? 100 : frac.length === 3 ? 1000 : 10
  return base + Number(frac) / denom
}

export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(LRC_LINE)
    if (!m) continue
    const text = m[4]?.trim() ?? ''
    lines.push({
      time: parseTimestamp(m[1]!, m[2]!, m[3]),
      text,
    })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

export function activeLineIndex(lines: LyricLine[], t: number): number {
  if (lines.length === 0) return -1
  let idx = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.time <= t) idx = i
    else break
  }
  return idx
}

