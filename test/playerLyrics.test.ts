import { describe, expect, it } from 'vitest'
import { activeLineIndex, parseLrc } from '../web/src/player/lyrics.js'

describe('player lyrics', () => {
  it('parseLrc reads timestamped lines', () => {
    const lines = parseLrc('[00:01.00]词\n[00:02.50]句')
    expect(lines).toEqual([
      { time: 1, text: '词' },
      { time: 2.5, text: '句' },
    ])
  })

  it('activeLineIndex picks the last line at or before t', () => {
    const lines = parseLrc('[00:01.00]词\n[00:02.50]句')
    expect(activeLineIndex(lines, 2.4)).toBe(0)
    expect(activeLineIndex(lines, 2.5)).toBe(1)
  })
})
