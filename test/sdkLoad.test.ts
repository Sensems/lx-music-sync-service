import { describe, expect, it } from 'vitest'
import sdk from '../src/sdk/load'

describe('sdk load', () => {
  it('imports without crash and exposes search/detail', () => {
    expect(Object.keys(sdk).sort()).toEqual(['kg', 'kw', 'mg', 'tx', 'wy'])
    expect(typeof sdk.wy.musicSearch.search).toBe('function')
    expect(typeof sdk.kg.songList.getListDetail).toBe('function')
  })
})
