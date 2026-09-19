import { describe, expect, it } from 'vitest'
import { parsePrefs, serializePrefs } from '../web/src/player/prefs.js'

const DEFAULTS = { volume: 1, muted: false, loop: 'off' as const, shuffle: false }

describe('player prefs', () => {
  it('parsePrefs(null) returns defaults', () => {
    expect(parsePrefs(null)).toEqual(DEFAULTS)
  })

  it('parsePrefs with invalid JSON returns defaults', () => {
    expect(parsePrefs('{')).toEqual(DEFAULTS)
  })

  it('parsePrefs clamps volume and keeps loop', () => {
    expect(parsePrefs('{"volume":1.5,"loop":"one"}')).toEqual({
      volume: 1,
      muted: false,
      loop: 'one',
      shuffle: false,
    })
  })

  it('serializePrefs round-trips', () => {
    const raw = serializePrefs({ volume: 0.4, muted: true, loop: 'all', shuffle: true })
    expect(parsePrefs(raw)).toEqual({
      volume: 0.4,
      muted: true,
      loop: 'all',
      shuffle: true,
    })
  })
})
