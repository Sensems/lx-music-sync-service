import { describe, expect, it } from 'vitest'
import {
  enqueue,
  nextIndex,
  playList,
  playOne,
  prevIndex,
} from '../web/src/player/queue.js'
import type { PlayItem, QueueState } from '../web/src/player/types.js'

function item(songKey: string, name = '歌'): PlayItem {
  return {
    songKey,
    name,
    singer: '人',
    picUrl: '',
    source: 'wy',
    musicInfo: {
      id: songKey,
      name,
      singer: '人',
      source: 'wy',
      interval: null,
      meta: {},
    },
  }
}

describe('player queue', () => {
  it('playOne replaces the queue with a single item at index 0', () => {
    const prev: QueueState = { items: [item('a'), item('b')], index: 1 }
    const next = playOne(item('c'))
    expect(next).toEqual({ items: [item('c')], index: 0 })
    expect(next).not.toBe(prev)
  })

  it('playList sets index 0 for multiple items', () => {
    const state = playList([item('a'), item('b'), item('c')])
    expect(state.index).toBe(0)
    expect(state.items.map(i => i.songKey)).toEqual(['a', 'b', 'c'])
  })

  it('enqueue on empty queue starts playback', () => {
    const empty: QueueState = { items: [], index: 0 }
    const { state, added, started } = enqueue(empty, item('a'))
    expect(added).toBe(true)
    expect(started).toBe(true)
    expect(state).toEqual({ items: [item('a')], index: 0 })
  })

  it('enqueue duplicate songKey returns added false', () => {
    const base = playList([item('a')])
    const { state, added, started } = enqueue(base, item('a', 'dup'))
    expect(added).toBe(false)
    expect(started).toBe(false)
    expect(state).toBe(base)
  })

  it('enqueue on non-empty appends without changing index', () => {
    const base = playList([item('a'), item('b')])
    const { state, added, started } = enqueue(base, item('c'))
    expect(added).toBe(true)
    expect(started).toBe(false)
    expect(state.index).toBe(0)
    expect(state.items.map(i => i.songKey)).toEqual(['a', 'b', 'c'])
  })

  it('nextIndex off at end returns null', () => {
    const state: QueueState = { items: [item('a'), item('b')], index: 1 }
    expect(nextIndex(state, 'off', false)).toBe(null)
  })

  it('nextIndex one returns current index', () => {
    const state: QueueState = { items: [item('a'), item('b')], index: 1 }
    expect(nextIndex(state, 'one', false)).toBe(1)
  })

  it('nextIndex all wraps to 0 at end', () => {
    const state: QueueState = { items: [item('a'), item('b')], index: 1 }
    expect(nextIndex(state, 'all', false)).toBe(0)
  })

  it('prevIndex at 0 with loop off returns null', () => {
    const state: QueueState = { items: [item('a'), item('b')], index: 0 }
    expect(prevIndex(state, 'off')).toBe(null)
  })
})
