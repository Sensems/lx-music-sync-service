import type { LoopMode } from './types.js'

export const PREFS_KEY = 'tingui-player'

export type PlayerPrefs = {
  volume: number
  muted: boolean
  loop: LoopMode
  shuffle: boolean
}

const DEFAULTS: PlayerPrefs = {
  volume: 1,
  muted: false,
  loop: 'off',
  shuffle: false,
}

const LOOP_MODES: LoopMode[] = ['off', 'one', 'all']

function clamp01(n: number): number {
  if (Number.isNaN(n)) return DEFAULTS.volume
  return Math.min(1, Math.max(0, n))
}

function isLoopMode(v: unknown): v is LoopMode {
  return typeof v === 'string' && (LOOP_MODES as string[]).includes(v)
}

export function parsePrefs(raw: string | null): PlayerPrefs {
  if (raw == null) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>
    if (parsed == null || typeof parsed !== 'object') return { ...DEFAULTS }
    return {
      volume: typeof parsed.volume === 'number' ? clamp01(parsed.volume) : DEFAULTS.volume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
      loop: isLoopMode(parsed.loop) ? parsed.loop : DEFAULTS.loop,
      shuffle: typeof parsed.shuffle === 'boolean' ? parsed.shuffle : DEFAULTS.shuffle,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function serializePrefs(p: PlayerPrefs): string {
  return JSON.stringify({
    volume: clamp01(p.volume),
    muted: Boolean(p.muted),
    loop: isLoopMode(p.loop) ? p.loop : DEFAULTS.loop,
    shuffle: Boolean(p.shuffle),
  })
}
