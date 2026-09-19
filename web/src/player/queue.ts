import type { LoopMode, PlayItem, QueueState } from './types.js'

export function playOne(item: PlayItem): QueueState {
  return { items: [item], index: 0 }
}

export function playList(items: PlayItem[]): QueueState {
  return { items: [...items], index: 0 }
}

export function enqueue(
  state: QueueState,
  item: PlayItem,
): { state: QueueState; added: boolean; started: boolean } {
  if (state.items.some(i => i.songKey === item.songKey)) {
    return { state, added: false, started: false }
  }
  if (state.items.length === 0) {
    return {
      state: { items: [item], index: 0 },
      added: true,
      started: true,
    }
  }
  return {
    state: { items: [...state.items, item], index: state.index },
    added: true,
    started: false,
  }
}

export function removeAt(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.items.length) return state
  const items = state.items.filter((_, i) => i !== index)
  if (items.length === 0) return { items: [], index: 0 }
  let nextIndex = state.index
  if (index < state.index) nextIndex -= 1
  else if (index === state.index) nextIndex = Math.min(nextIndex, items.length - 1)
  return { items, index: nextIndex }
}

export function jumpTo(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.items.length) return state
  return { ...state, index }
}

export function nextIndex(
  state: QueueState,
  loop: LoopMode,
  shuffle: boolean,
  rng: () => number = Math.random,
): number | null {
  const { items, index } = state
  if (items.length === 0) return null
  if (loop === 'one') return index
  if (shuffle && items.length > 1) {
    const rest = items.map((_, i) => i).filter(i => i !== index)
    const pick = rest[Math.floor(rng() * rest.length)]!
    return pick
  }
  if (index < items.length - 1) return index + 1
  if (loop === 'all') return 0
  return null
}

export function prevIndex(state: QueueState, loop: LoopMode): number | null {
  const { items, index } = state
  if (items.length === 0) return null
  if (loop === 'one') return index
  if (index > 0) return index - 1
  if (loop === 'all') return items.length - 1
  return null
}
