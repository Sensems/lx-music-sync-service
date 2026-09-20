import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { api } from '../api.js'
import { activeLineIndex, parseLrc } from './lyrics.js'
import { PREFS_KEY, parsePrefs, serializePrefs } from './prefs.js'
import {
  enqueue as enqueueItem,
  jumpTo as jumpToIndex,
  nextIndex,
  playList as buildPlayList,
  playOne as buildPlayOne,
  prevIndex,
  removeAt as removeAtIndex,
} from './queue.js'
import type { LoopMode, LyricLine, PlayItem } from './types.js'

export type PlayerApi = {
  queue: Ref<PlayItem[]>
  index: Ref<number>
  current: ComputedRef<PlayItem | null>
  playing: Ref<boolean>
  currentTime: Ref<number>
  duration: Ref<number>
  volume: Ref<number>
  muted: Ref<boolean>
  loop: Ref<LoopMode>
  shuffle: Ref<boolean>
  expanded: Ref<boolean>
  carMode: Ref<boolean>
  showQueue: Ref<boolean>
  lyricLines: Ref<LyricLine[]>
  lyricIndex: Ref<number>
  error: Ref<string>
  playOne(item: PlayItem): Promise<void>
  playList(items: PlayItem[]): Promise<void>
  enqueue(item: PlayItem): { added: boolean; started: boolean }
  removeAt(index: number): void
  jumpTo(index: number): Promise<void>
  toggle(): void
  seek(t: number): void
  next(): Promise<void>
  prev(): Promise<void>
  setVolume(v: number): void
  toggleMute(): void
  setLoop(m: LoopMode): void
  setShuffle(v: boolean): void
  expand(): void
  collapse(): void
  enterCar(): void
  exitCar(): void
}

const audio: HTMLAudioElement | null =
  typeof Audio === 'undefined' ? null : new Audio()

let singleton: PlayerApi | null = null
let mediaHandlersBound = false

function readPrefsFromStorage() {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return parsePrefs(null)
  }
}

function writePrefs(volume: number, muted: boolean, loop: LoopMode, shuffle: boolean) {
  try {
    localStorage.setItem(PREFS_KEY, serializePrefs({ volume, muted, loop, shuffle }))
  } catch {
    /* ignore quota / private mode */
  }
}

function createPlayer(): PlayerApi {
  const initial = readPrefsFromStorage()

  const queue = ref<PlayItem[]>([])
  const index = ref(0)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(initial.volume)
  const muted = ref(initial.muted)
  const loop = ref<LoopMode>(initial.loop)
  const shuffle = ref(initial.shuffle)
  const expanded = ref(false)
  const carMode = ref(false)
  const showQueue = ref(false)
  const lyricLines = ref<LyricLine[]>([])
  const lyricIndex = ref(-1)
  const error = ref('')

  const current = computed(() => queue.value[index.value] ?? null)

  let loadSeq = 0

  if (audio) {
    audio.volume = volume.value
    audio.muted = muted.value

    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio.currentTime
      lyricIndex.value = activeLineIndex(lyricLines.value, audio.currentTime)
    })
    audio.addEventListener('durationchange', () => {
      duration.value = Number.isFinite(audio.duration) ? audio.duration : 0
    })
    audio.addEventListener('play', () => {
      playing.value = true
      syncMediaPlaybackState()
    })
    audio.addEventListener('pause', () => {
      playing.value = false
      syncMediaPlaybackState()
    })
    audio.addEventListener('ended', () => {
      void onEnded()
    })
    audio.addEventListener('error', () => {
      error.value = '暂时没有可播放的地址'
      playing.value = false
      syncMediaPlaybackState()
    })
  }

  watch([volume, muted, loop, shuffle], () => {
    writePrefs(volume.value, muted.value, loop.value, shuffle.value)
    if (audio) {
      audio.volume = volume.value
      audio.muted = muted.value
    }
  })

  watch(current, item => {
    syncMediaMetadata(item)
  })

  function syncMediaMetadata(item: PlayItem | null) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (!item) {
      navigator.mediaSession.metadata = null
      return
    }
    const artwork = item.picUrl
      ? [{ src: item.picUrl, sizes: '512x512', type: 'image/jpeg' }]
      : []
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.name,
      artist: item.singer,
      artwork,
    })
  }

  function syncMediaPlaybackState() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing.value ? 'playing' : 'paused'
  }

  function bindMediaHandlers() {
    if (mediaHandlersBound) return
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    mediaHandlersBound = true
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => {
      void audio?.play().catch(() => {
        playing.value = false
      })
    })
    ms.setActionHandler('pause', () => {
      audio?.pause()
    })
    ms.setActionHandler('previoustrack', () => {
      void prev()
    })
    ms.setActionHandler('nexttrack', () => {
      void next()
    })
    ms.setActionHandler('seekto', details => {
      if (typeof details.seekTime === 'number') seek(details.seekTime)
    })
  }

  async function loadCurrent(): Promise<void> {
    const item = current.value
    if (!item || !audio) {
      playing.value = false
      return
    }
    const seq = ++loadSeq
    error.value = ''
    lyricLines.value = []
    lyricIndex.value = -1
    currentTime.value = 0
    duration.value = 0

    void loadLyrics(item, seq)
    try {
      if (item.musicInfo) {
        await api.rememberStream(item.musicInfo)
      }
      if (seq !== loadSeq) return
      audio.src = api.streamUrl(item.songKey)
      audio.load()
      await audio.play()
      if (seq !== loadSeq) return
      playing.value = true
      bindMediaHandlers()
      syncMediaMetadata(item)
      syncMediaPlaybackState()
    } catch {
      if (seq !== loadSeq) return
      error.value = '暂时没有可播放的地址'
      playing.value = false
      // 清掉 src，避免 toggle 又播起上一首残留地址
      audio.removeAttribute('src')
      audio.load()
      syncMediaPlaybackState()
    }
  }

  function patchCurrent(partial: Partial<PlayItem>) {
    const i = index.value
    const cur = queue.value[i]
    if (!cur) return
    const next = queue.value.slice()
    next[i] = { ...cur, ...partial }
    queue.value = next
  }

  function linesFromLyric(raw: string): LyricLine[] {
    const parsed = parseLrc(raw)
    if (parsed.length > 0) return parsed
    return raw
      .split(/\r?\n/)
      .map(text => text.trim())
      .filter(text => text && !text.startsWith('['))
      .map((text, i) => ({ time: i, text }))
  }

  async function loadLyrics(item: PlayItem, seq: number) {
    try {
      const body = await api.lyricsFor(
        item.musicInfo
          ? { musicInfo: item.musicInfo }
          : { songKey: item.songKey },
      )
      if (seq !== loadSeq) return
      lyricLines.value = linesFromLyric(body.lyric || '')
      lyricIndex.value = activeLineIndex(lyricLines.value, audio?.currentTime ?? 0)
      const picUrl = String(body.picUrl || '').trim()
      if (picUrl && picUrl !== 'null' && picUrl !== item.picUrl) {
        patchCurrent({ picUrl })
        syncMediaMetadata({ ...item, picUrl })
      }
    } catch {
      if (seq !== loadSeq) return
      lyricLines.value = []
      lyricIndex.value = -1
    }
  }

  async function onEnded() {
    if (!audio) return
    if (loop.value === 'one') {
      audio.currentTime = 0
      try {
        await audio.play()
        playing.value = true
      } catch {
        playing.value = false
      }
      return
    }
    const ni = nextIndex(
      { items: queue.value, index: index.value },
      loop.value,
      shuffle.value,
    )
    if (ni == null) {
      playing.value = false
      syncMediaPlaybackState()
      return
    }
    index.value = ni
    await loadCurrent()
  }

  async function playOne(item: PlayItem): Promise<void> {
    const state = buildPlayOne(item)
    queue.value = state.items
    index.value = state.index
    await loadCurrent()
  }

  async function playList(items: PlayItem[]): Promise<void> {
    const state = buildPlayList(items)
    queue.value = state.items
    index.value = state.index
    if (state.items.length === 0) {
      playing.value = false
      if (audio) {
        audio.removeAttribute('src')
        audio.load()
      }
      return
    }
    await loadCurrent()
  }

  function enqueue(item: PlayItem): { added: boolean; started: boolean } {
    const result = enqueueItem({ items: queue.value, index: index.value }, item)
    queue.value = result.state.items
    index.value = result.state.index
    if (result.started) void loadCurrent()
    return { added: result.added, started: result.started }
  }

  function removeAt(i: number): void {
    const prev = index.value
    const state = removeAtIndex({ items: queue.value, index: index.value }, i)
    queue.value = state.items
    index.value = state.index
    if (state.items.length === 0) {
      playing.value = false
      lyricLines.value = []
      lyricIndex.value = -1
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      syncMediaMetadata(null)
      return
    }
    if (i === prev) void loadCurrent()
  }

  async function jumpTo(i: number): Promise<void> {
    if (i < 0 || i >= queue.value.length || i === index.value) return
    const state = jumpToIndex({ items: queue.value, index: index.value }, i)
    queue.value = state.items
    index.value = state.index
    await loadCurrent()
  }

  function toggle(): void {
    if (!audio) return
    if (playing.value) {
      audio.pause()
      return
    }
    if (!current.value) return
    void audio.play().catch(() => {
      error.value = '暂时没有可播放的地址'
      playing.value = false
    })
  }

  function seek(t: number): void {
    if (!audio) return
    const next = Math.max(0, Number.isFinite(t) ? t : 0)
    audio.currentTime = next
    currentTime.value = next
    lyricIndex.value = activeLineIndex(lyricLines.value, next)
  }

  async function next(): Promise<void> {
    // 手动下一首忽略「单曲循环」，留给 ended 处理原地重播
    const effectiveLoop: LoopMode = loop.value === 'one' ? 'all' : loop.value
    const ni = nextIndex(
      { items: queue.value, index: index.value },
      effectiveLoop,
      shuffle.value,
    )
    if (ni == null) return
    index.value = ni
    await loadCurrent()
  }

  async function prev(): Promise<void> {
    if (audio && audio.currentTime > 3) {
      seek(0)
      return
    }
    const effectiveLoop: LoopMode = loop.value === 'one' ? 'all' : loop.value
    const pi = prevIndex({ items: queue.value, index: index.value }, effectiveLoop)
    if (pi == null) {
      seek(0)
      return
    }
    index.value = pi
    await loadCurrent()
  }

  function setVolume(v: number): void {
    volume.value = Math.min(1, Math.max(0, v))
  }

  function toggleMute(): void {
    muted.value = !muted.value
  }

  function setLoop(m: LoopMode): void {
    loop.value = m
  }

  function setShuffle(v: boolean): void {
    shuffle.value = v
  }

  async function routerRef() {
    const { default: router } = await import('../router.js')
    return router
  }

  function expand(): void {
    void routerRef().then(router => {
      if (router.currentRoute.value.name === 'now') return
      void router.push({ name: 'now' })
    })
  }

  function collapse(): void {
    carMode.value = false
    showQueue.value = false
    void routerRef().then(router => {
      if (router.currentRoute.value.name !== 'now') return
      const back = typeof window !== 'undefined' ? window.history.state?.back : null
      if (back != null) router.back()
      else void router.replace({ name: 'shelf' })
    })
  }

  function enterCar(): void {
    carMode.value = true
    expand()
  }

  function exitCar(): void {
    carMode.value = false
  }

  return {
    queue,
    index,
    current,
    playing,
    currentTime,
    duration,
    volume,
    muted,
    loop,
    shuffle,
    expanded,
    carMode,
    showQueue,
    lyricLines,
    lyricIndex,
    error,
    playOne,
    playList,
    enqueue,
    removeAt,
    jumpTo,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    setLoop,
    setShuffle,
    expand,
    collapse,
    enterCar,
    exitCar,
  }
}

export function usePlayer(): PlayerApi {
  if (!singleton) singleton = createPlayer()
  return singleton
}
