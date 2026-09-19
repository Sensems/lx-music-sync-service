<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { usePlayer } from './usePlayer'
import PlayerSleeve from './PlayerSleeve.vue'
import type { LoopMode } from './types'

const {
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
  jumpTo,
  removeAt,
} = usePlayer()

const showVol = ref(false)
const lyricsEl = ref<HTMLElement | null>(null)

const canSkip = computed(() => queue.value.length >= 2)

const progressMax = computed(() => {
  const d = duration.value
  return d > 0 && Number.isFinite(d) ? d : 0
})

const progressPct = computed(() => {
  if (progressMax.value <= 0) return '0%'
  const p = (currentTime.value / progressMax.value) * 100
  return `${Math.min(100, Math.max(0, p))}%`
})

const volumePct = computed(() => `${(muted.value ? 0 : volume.value) * 100}%`)

const loopLabel = computed(() => {
  if (loop.value === 'one') return '单曲'
  if (loop.value === 'all') return '列表'
  return '顺序'
})

const carLyrics = computed(() => {
  const lines = lyricLines.value
  const textAt = (i: number) => {
    if (i < 0 || i >= lines.length) return ' '
    return lines[i]?.text || ' '
  }
  if (lines.length === 0) {
    return { farPrev: ' ', prev: ' ', now: '暂无歌词', next: ' ', farNext: ' ' }
  }
  const i = lyricIndex.value < 0 ? 0 : lyricIndex.value
  return {
    farPrev: textAt(i - 2),
    prev: textAt(i - 1),
    now: textAt(i),
    next: textAt(i + 1),
    farNext: textAt(i + 2),
  }
})

watch(error, (msg) => {
  if (msg) message.error(msg)
})

function scrollActiveLyric(smooth = true) {
  if (!expanded.value || carMode.value) return
  const root = lyricsEl.value
  const i = lyricIndex.value
  if (!root || i < 0) return
  const el = root.querySelector(`[data-lyric-line="${i}"]`)
  if (!(el instanceof HTMLElement)) return
  // offsetTop 相对的是 position:relative 的播放页，不是歌词滚动区
  const rootRect = root.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const top =
    root.scrollTop + (elRect.top + elRect.height / 2) - (rootRect.top + root.clientHeight / 2)
  root.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
}

function queueLyricScroll(smooth: boolean) {
  void nextTick(() => {
    requestAnimationFrame(() => scrollActiveLyric(smooth))
  })
}

watch(lyricIndex, () => {
  queueLyricScroll(true)
})

watch([expanded, carMode], ([exp, car]) => {
  if (!exp || car) return
  queueLyricScroll(false)
})

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function onSeek(ev: Event) {
  const el = ev.target as HTMLInputElement
  seek(Number(el.value))
}

function onVolume(ev: Event) {
  const el = ev.target as HTMLInputElement
  setVolume(Number(el.value))
}

function cycleLoop() {
  const order: LoopMode[] = ['off', 'all', 'one']
  const i = order.indexOf(loop.value)
  setLoop(order[(i + 1) % order.length]!)
}

function toggleExpand() {
  showVol.value = false
  if (expanded.value) collapse()
  else expand()
}

function toggleVol() {
  showQueue.value = false
  showVol.value = !showVol.value
}

function toggleQueue() {
  showVol.value = false
  showQueue.value = !showQueue.value
}

function onCarToggle() {
  if (carMode.value) exitCar()
  else {
    showQueue.value = false
    showVol.value = false
    enterCar()
  }
}

function onKey(ev: KeyboardEvent) {
  if (ev.key !== 'Escape') return
  if (showQueue.value) {
    showQueue.value = false
    return
  }
  if (showVol.value) {
    showVol.value = false
    return
  }
  if (carMode.value) {
    exitCar()
    return
  }
  if (expanded.value) collapse()
}

function onPointerDown(ev: PointerEvent) {
  if (!showVol.value) return
  const t = ev.target
  if (t instanceof Node) {
    const root = document.querySelector('.player-bar__vol')
    if (root?.contains(t)) return
  }
  showVol.value = false
}

watch(
  [expanded, carMode],
  ([exp, car]) => {
    document.documentElement.classList.toggle('player-lock-scroll', exp || car)
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onPointerDown, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onPointerDown, true)
  document.documentElement.classList.remove('player-lock-scroll')
})
</script>

<template>
  <template v-if="current">
    <!-- 歌曲详情：盖住页面，底栏仍留着（网易云桌面端交互） -->
    <div
      v-if="expanded && !carMode"
      class="player-now"
      role="dialog"
      aria-modal="true"
      aria-label="正在播放"
    >
      <div
        class="player-now__bg"
        :style="current.picUrl ? { backgroundImage: `url(${current.picUrl})` } : undefined"
        aria-hidden="true"
      />
      <div class="player-now__shade" aria-hidden="true" />

      <div class="player-now__head">
        <span class="player-now__head-spacer" />
        <button type="button" class="player-now__fold" aria-label="收起" @click="collapse">
          <span class="i-lucide-chevron-down text-xl" aria-hidden="true" />
        </button>
        <button type="button" class="player-now__car" @click="onCarToggle">
          <span class="i-lucide-car-front text-lg" aria-hidden="true" />
          车载
        </button>
      </div>

      <div class="player-now__body">
        <div class="player-now__disc">
          <PlayerSleeve variant="disc" :pic-url="current.picUrl" :name="current.name" :playing="playing" />
          <div class="player-now__modes">
            <button
              type="button"
              class="player-ctrl"
              :class="loop !== 'off' ? 'is-on' : ''"
              :aria-label="`循环：${loopLabel}`"
              @click="cycleLoop"
            >
              <span v-if="loop === 'one'" class="i-lucide-repeat-1" aria-hidden="true" />
              <span v-else-if="loop === 'all'" class="i-lucide-repeat" aria-hidden="true" />
              <span v-else class="i-lucide-list-ordered" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="player-ctrl"
              :class="shuffle ? 'is-on' : ''"
              aria-label="随机"
              :aria-pressed="shuffle"
              @click="setShuffle(!shuffle)"
            >
              <span class="i-lucide-shuffle" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="player-now__lyric-col">
          <h2 class="player-now__title">{{ current.name }}</h2>
          <p class="player-now__artist">{{ current.singer }}</p>
          <p v-if="error" class="player-now__err">
            <span class="i-lucide-circle-alert" aria-hidden="true" />
            {{ error }}
          </p>
          <div ref="lyricsEl" class="player-now__lyrics">
            <p v-if="lyricLines.length === 0" class="player-now__empty">暂无歌词</p>
            <p
              v-for="(line, i) in lyricLines"
              :key="`${line.time}-${i}`"
              :data-lyric-line="i"
              class="player-now__line"
              :class="i === lyricIndex ? 'is-now' : ''"
            >
              {{ line.text || ' ' }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 车载：左右两栏 + 大歌词 + 进度，盖住底栏 -->
    <div
      v-if="carMode"
      class="player-car"
      role="dialog"
      aria-modal="true"
      aria-label="车载播放器"
    >
      <header class="player-car__head">
        <button type="button" class="player-ctrl player-ctrl--label player-ctrl--lg" @click="exitCar">
          <span class="i-lucide-chevron-down text-2xl" aria-hidden="true" />
          返回
        </button>
        <button type="button" class="player-ctrl player-ctrl--label player-ctrl--lg is-on" @click="exitCar">
          <span class="i-lucide-car-front text-xl" aria-hidden="true" />
          车载
        </button>
      </header>
      <div class="player-car__body">
        <div class="player-car__disc">
          <PlayerSleeve variant="disc" :pic-url="current.picUrl" :name="current.name" :playing="playing" />
          <div class="player-car__meta">
            <h2 class="player-car__title">{{ current.name }}</h2>
            <p class="player-car__artist">{{ current.singer }}</p>
          </div>
        </div>
        <div class="player-car__lyric-col" aria-live="polite">
          <p class="player-car__line is-far">{{ carLyrics.farPrev }}</p>
          <p class="player-car__line is-prev">{{ carLyrics.prev }}</p>
          <p class="player-car__line is-now">{{ carLyrics.now }}</p>
          <p class="player-car__line is-next">{{ carLyrics.next }}</p>
          <p class="player-car__line is-far">{{ carLyrics.farNext }}</p>
        </div>
      </div>
      <div class="player-car__seek">
        <span class="player-car__clock">{{ formatTime(currentTime) }}</span>
        <input
          class="player-groove player-groove--car"
          type="range"
          min="0"
          :max="progressMax || 1"
          step="0.1"
          :value="currentTime"
          :disabled="progressMax <= 0"
          :style="{ '--p': progressPct }"
          aria-label="播放进度"
          @input="onSeek"
        />
        <span class="player-car__clock player-car__clock--end">{{
          progressMax > 0 ? formatTime(progressMax) : '--:--'
        }}</span>
      </div>
      <div class="player-car__controls">
        <div class="player-car__transport">
          <button type="button" class="player-ctrl player-car__btn" :disabled="!canSkip" aria-label="上一首" @click="prev">
            <span class="i-lucide-skip-back" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="player-ctrl player-hub player-car__hub"
            :aria-label="playing ? '暂停' : '播放'"
            @click="toggle"
          >
            <span v-if="playing" class="i-lucide-pause" aria-hidden="true" />
            <span v-else class="i-lucide-play player-hub__play" aria-hidden="true" />
          </button>
          <button type="button" class="player-ctrl player-car__btn" :disabled="!canSkip" aria-label="下一首" @click="next">
            <span class="i-lucide-skip-forward" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          class="player-ctrl player-car__btn player-car__queue-btn"
          :class="showQueue ? 'is-on' : ''"
          aria-label="播放列表"
          :aria-expanded="showQueue"
          @click="toggleQueue"
        >
          <span class="i-lucide-list-music" aria-hidden="true" />
          <span class="player-bar__badge">{{ queue.length }}</span>
        </button>
      </div>
    </div>

    <!-- 底栏常驻 -->
    <div v-if="!carMode" class="player-bar">
      <div class="player-bar__left">
        <button type="button" class="player-bar__cover" :aria-label="expanded ? '收起播放页' : '打开播放页'" @click="toggleExpand">
          <PlayerSleeve variant="thumb" :pic-url="current.picUrl" :name="current.name" :open="expanded" />
        </button>
        <button type="button" class="player-bar__meta" @click="toggleExpand">
          <span class="player-bar__name">{{ current.name }}</span>
          <span class="player-bar__singer">{{ current.singer }}</span>
          <span v-if="error" class="player-bar__err">{{ error }}</span>
        </button>
      </div>

      <div class="player-bar__center">
        <div class="player-bar__transport">
          <button
            type="button"
            class="player-ctrl"
            :class="loop !== 'off' ? 'is-on' : ''"
            :aria-label="`循环：${loopLabel}`"
            :title="`循环：${loopLabel}`"
            @click="cycleLoop"
          >
            <span v-if="loop === 'one'" class="i-lucide-repeat-1" aria-hidden="true" />
            <span v-else-if="loop === 'all'" class="i-lucide-repeat" aria-hidden="true" />
            <span v-else class="i-lucide-list-ordered" aria-hidden="true" />
          </button>
          <button type="button" class="player-ctrl" :disabled="!canSkip" aria-label="上一首" @click="prev">
            <span class="i-lucide-skip-back text-lg" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="player-ctrl player-hub"
            :aria-label="playing ? '暂停' : '播放'"
            @click="toggle"
          >
            <span v-if="playing" class="i-lucide-pause text-xl" aria-hidden="true" />
            <span v-else class="i-lucide-play text-xl player-hub__play" aria-hidden="true" />
          </button>
          <button type="button" class="player-ctrl" :disabled="!canSkip" aria-label="下一首" @click="next">
            <span class="i-lucide-skip-forward text-lg" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="player-ctrl"
            :class="shuffle ? 'is-on' : ''"
            aria-label="随机"
            :aria-pressed="shuffle"
            @click="setShuffle(!shuffle)"
          >
            <span class="i-lucide-shuffle" aria-hidden="true" />
          </button>
        </div>
        <div class="player-bar__seek">
          <span class="player-bar__clock">{{ formatTime(currentTime) }}</span>
          <input
            class="player-groove"
            type="range"
            min="0"
            :max="progressMax || 1"
            step="0.1"
            :value="currentTime"
            :disabled="progressMax <= 0"
            :style="{ '--p': progressPct }"
            aria-label="播放进度"
            @input="onSeek"
          />
          <span class="player-bar__clock player-bar__clock--end">{{
            progressMax > 0 ? formatTime(progressMax) : '--:--'
          }}</span>
        </div>
      </div>

      <div class="player-bar__right">
        <button
          type="button"
          class="player-ctrl player-hub player-bar__mplay"
          :aria-label="playing ? '暂停' : '播放'"
          @click="toggle"
        >
          <span v-if="playing" class="i-lucide-pause text-xl" aria-hidden="true" />
          <span v-else class="i-lucide-play text-xl player-hub__play" aria-hidden="true" />
        </button>
        <div class="player-bar__vol">
          <button
            type="button"
            class="player-ctrl"
            :aria-label="muted ? '取消静音' : '音量'"
            :aria-expanded="showVol"
            @click="toggleVol"
          >
            <span v-if="muted || volume === 0" class="i-lucide-volume-x" aria-hidden="true" />
            <span v-else-if="volume < 0.4" class="i-lucide-volume-1" aria-hidden="true" />
            <span v-else class="i-lucide-volume-2" aria-hidden="true" />
          </button>
          <div v-if="showVol" class="player-bar__vol-pop" @click.stop>
            <input
              class="player-groove player-groove--vol"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="muted ? 0 : volume"
              :style="{ '--p': volumePct }"
              aria-label="音量"
              @input="onVolume"
            />
          </div>
        </div>
        <button
          type="button"
          class="player-ctrl player-bar__ci"
          :class="expanded ? 'is-on' : ''"
          aria-label="歌词"
          :aria-pressed="expanded"
          @click="toggleExpand"
        >
          词
        </button>
        <button
          type="button"
          class="player-ctrl player-bar__queue-btn"
          :class="showQueue ? 'is-on' : ''"
          aria-label="播放列表"
          :aria-expanded="showQueue"
          @click="toggleQueue"
        >
          <span class="i-lucide-list-music" aria-hidden="true" />
          <span class="player-bar__badge">{{ queue.length }}</span>
        </button>
      </div>
    </div>

    <aside
      v-if="showQueue"
      class="player-queue"
      :class="carMode ? 'player-queue--car' : ''"
      aria-label="播放列表"
    >
      <div class="player-queue__head">
        <h3 class="player-queue__title">播放列表 · {{ queue.length }}</h3>
        <button type="button" class="player-ctrl" aria-label="关闭播放列表" @click="showQueue = false">
          <span class="i-lucide-x" aria-hidden="true" />
        </button>
      </div>
      <ul class="player-queue__list">
        <li
          v-for="(item, i) in queue"
          :key="`${item.songKey}-${i}`"
          class="player-queue__item"
          :class="i === index ? 'is-current' : ''"
        >
          <button type="button" class="player-queue__jump" @click="jumpTo(i)">
            <span v-if="i === index" class="i-lucide-volume-2 player-queue__now" aria-hidden="true" />
            <span v-else class="player-queue__idx">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="player-queue__meta">
              <span class="player-queue__name">{{ item.name }}</span>
              <span class="player-queue__singer">{{ item.singer }}</span>
            </span>
          </button>
          <button type="button" class="player-ctrl player-ctrl--sm" aria-label="移出队列" @click="removeAt(i)">
            <span class="i-lucide-x" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </aside>
    <div
      v-if="showQueue"
      class="player-queue__scrim"
      :class="carMode ? 'player-queue__scrim--car' : ''"
      aria-hidden="true"
      @click="showQueue = false"
    />
  </template>
</template>

<style scoped>
.player-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--ribbon-h);
  z-index: 34;
  display: grid;
  grid-template-columns: minmax(12rem, 1fr) minmax(18rem, 1.5fr) minmax(9rem, 1fr);
  align-items: center;
  gap: 0.75rem;
  min-height: 4.5rem;
  padding: 0.45rem max(1rem, var(--safe-r)) 0.45rem max(1rem, var(--safe-l));
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.player-bar__left {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.player-bar__cover {
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0.25rem;
}

.player-bar__meta {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  min-width: 0;
  text-align: left;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.player-bar__name,
.player-bar__singer,
.player-bar__err {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-bar__name {
  font-size: 0.88rem;
  line-height: 1.3;
  color: var(--fg);
}

.player-bar__singer {
  font-size: 0.75rem;
  color: var(--mute);
}

.player-bar__err {
  font-size: 0.72rem;
  color: var(--rec);
}

.player-bar__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
}

.player-bar__transport {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.player-bar__seek {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  max-width: 26rem;
}

.player-bar__clock {
  width: 2.2rem;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.68rem;
  color: var(--mute);
  font-variant-numeric: tabular-nums;
}

.player-bar__clock--end {
  text-align: right;
}

.player-bar__right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.1rem;
}

.player-bar__mplay {
  display: none;
}

.player-bar__vol {
  position: relative;
}

.player-bar__vol-pop {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 0.45rem);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.55rem;
  height: 8.4rem;
  padding: 0.7rem 0;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  box-shadow: 0 10px 28px color-mix(in srgb, #000 32%, transparent);
  transform: translateX(-50%);
}

.player-bar__ci {
  font-size: 0.84rem;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.player-bar__queue-btn {
  position: relative;
}

.player-bar__badge {
  position: absolute;
  top: 0.2rem;
  right: 0.15rem;
  min-width: 0.9rem;
  padding: 0 0.2rem;
  font-size: 0.6rem;
  line-height: 1.1rem;
  text-align: center;
  border-radius: 999px;
  background: var(--foil);
  color: var(--ink);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

html[data-theme-mode='light'] .player-bar__badge {
  color: var(--card);
}

.player-groove {
  appearance: none;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--foil) 0,
    var(--foil) var(--p, 0%),
    color-mix(in srgb, var(--border) 75%, transparent) var(--p, 0%)
  );
  outline: none;
  cursor: pointer;
  touch-action: manipulation;
}

.player-groove--vol {
  width: 6.6rem;
  height: 3px;
  flex-shrink: 0;
  transform: rotate(-90deg);
}

.player-groove::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--foil);
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.player-groove:hover::-webkit-slider-thumb,
.player-groove:focus-visible::-webkit-slider-thumb {
  opacity: 1;
  transform: scale(1.15);
}

.player-groove::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--foil);
  border: none;
  cursor: pointer;
  opacity: 0;
}

.player-groove:hover::-moz-range-thumb,
.player-groove:focus-visible::-moz-range-thumb {
  opacity: 1;
}

.player-groove--vol::-webkit-slider-thumb,
.player-groove--vol::-moz-range-thumb {
  opacity: 1;
}

.player-ctrl {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-width: 2.5rem;
  min-height: 2.5rem;
  padding: 0;
  border-radius: 999px;
  font: inherit;
  touch-action: manipulation;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.15s ease,
    opacity 0.18s ease;
}

.player-ctrl:hover {
  color: var(--foil);
}

.player-ctrl:active {
  transform: scale(0.94);
}

.player-ctrl:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.player-ctrl:disabled:hover {
  color: var(--fg);
}

.player-ctrl.is-on {
  color: var(--foil);
}

.player-ctrl--label {
  padding: 0 0.7rem;
  font-size: 0.85rem;
}

.player-ctrl--lg {
  min-height: 3rem;
  font-size: 1rem;
  padding: 0 1rem;
}

.player-ctrl--sm {
  min-width: 2.25rem;
  min-height: 2.25rem;
}

.player-hub {
  width: 2.35rem;
  height: 2.35rem;
  min-width: 2.35rem;
  border: 2px solid var(--fg);
  color: var(--fg);
}

.player-hub:hover {
  border-color: var(--foil);
  color: var(--foil);
  background: transparent;
}

.player-hub__play {
  margin-left: 2px;
}

.player-ctrl.player-bar__mplay {
  display: none;
}

.player-now {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: var(--chrome-bottom);
  z-index: 31;
  display: flex;
  flex-direction: column;
  overflow: clip;
  animation: player-now-in 0.28s ease-out;
  padding-top: env(safe-area-inset-top, 0);
  background: var(--cabinet);
}

.player-now__bg {
  position: absolute;
  inset: 0;
  background: var(--cabinet) center / cover no-repeat;
  filter: blur(60px) saturate(1.2);
  transform: scale(1.12);
  opacity: 0.55;
  pointer-events: none;
}

.player-now__shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    color-mix(in srgb, var(--cabinet) 82%, transparent),
    color-mix(in srgb, #000 28%, transparent);
}

.player-now__head {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0.35rem 0.75rem 0;
}

.player-now__head-spacer {
  justify-self: start;
}

.player-now__fold,
.player-now__car {
  appearance: none;
  border: 0;
  background: color-mix(in srgb, var(--fg) 14%, transparent);
  color: var(--fg);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 2.5rem;
  min-width: 2.5rem;
  padding: 0 0.85rem;
  border-radius: 999px;
}

.player-now__fold {
  grid-column: 2;
}

.player-now__car {
  grid-column: 3;
  justify-self: end;
  font-size: 0.85rem;
}

.player-now__fold:hover,
.player-now__car:hover {
  color: var(--foil);
}

.player-now__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 4.5rem;
  padding: 1.25rem 6vw 2rem;
}

.player-now__disc {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}

.player-now__modes {
  display: none;
  align-items: center;
  gap: 0.5rem;
}

.player-now__lyric-col {
  flex: 1;
  min-width: 0;
  max-width: 32rem;
  height: min(32rem, 70vh);
  display: flex;
  flex-direction: column;
}

.player-now__title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 500;
  text-align: center;
}

.player-now__artist {
  margin: 0.45rem 0 1rem;
  text-align: center;
  color: var(--mute);
  font-size: 0.9rem;
}

.player-now__err {
  margin: 0 0 0.75rem;
  text-align: center;
  color: var(--rec);
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
}

.player-now__lyrics {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
  padding: 1.5rem 0.5rem;
}

.player-now__empty {
  margin: 3rem 0 0;
  text-align: center;
  color: var(--mute);
}

.player-now__line {
  margin: 0;
  padding: 0.55rem 0.4rem;
  text-align: center;
  font-size: 0.95rem;
  line-height: 1.7;
  color: color-mix(in srgb, var(--fg) 42%, transparent);
  transition: color 0.2s ease, font-size 0.2s ease;
}

.player-now__line.is-now {
  color: var(--fg);
  font-size: 1.2rem;
  font-weight: 500;
}

.player-queue {
  position: fixed;
  right: 0.75rem;
  bottom: calc(var(--chrome-bottom) + 0.5rem);
  overscroll-behavior: contain;
  z-index: 36;
  width: min(22rem, calc(100vw - 1.5rem));
  height: min(26rem, 58vh);
  display: flex;
  flex-direction: column;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  box-shadow: 0 16px 48px color-mix(in srgb, #000 38%, transparent);
  animation: player-pop 0.2s ease-out;
}

.player-queue__scrim {
  position: fixed;
  inset: 0;
  z-index: 35;
  background: transparent;
}

.player-queue--car {
  z-index: 42;
  bottom: calc(10.75rem + env(safe-area-inset-bottom, 0));
}

.player-queue__scrim--car {
  z-index: 41;
}

.player-queue__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.55rem 0.45rem 1rem;
  border-bottom: 1px solid var(--border);
}

.player-queue__title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 500;
}

.player-queue__list {
  margin: 0;
  padding: 0;
  list-style: none;
  flex: 1;
  overflow-y: auto;
}

.player-queue__item {
  display: flex;
  align-items: center;
  padding: 0 0.3rem;
}

.player-queue__item.is-current {
  background: color-mix(in srgb, var(--foil) 12%, transparent);
}

.player-queue__jump {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.4rem;
  text-align: left;
}

.player-queue__idx {
  width: 1.35rem;
  flex-shrink: 0;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.68rem;
  color: var(--mute);
}

.player-queue__now {
  color: var(--foil);
  flex-shrink: 0;
}

.player-queue__meta {
  min-width: 0;
}

.player-queue__name,
.player-queue__singer {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-queue__name {
  font-size: 0.86rem;
}

.player-queue__item.is-current .player-queue__name {
  color: var(--foil);
}

.player-queue__singer {
  margin-top: 0.12rem;
  font-size: 0.72rem;
  color: var(--mute);
}

.player-car {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  overflow: clip;
  background: var(--cabinet);
  color: var(--fg);
  overscroll-behavior: contain;
  animation: player-now-in 0.28s ease-out;
  padding-top: env(safe-area-inset-top, 0);
}

.player-car__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.75rem;
  flex-shrink: 0;
}

.player-car__body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 4.5rem;
  padding: 0.5rem 6vw 0.75rem;
}

.player-car__disc {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.15rem;
  min-width: 0;
}

.player-car__meta {
  text-align: center;
  max-width: 100%;
}

.player-car__title {
  margin: 0;
  font-size: clamp(1.4rem, 3.2vw, 2rem);
  font-weight: 500;
}

.player-car__artist {
  margin: 0.4rem 0 0;
  font-size: 1.05rem;
  color: var(--mute);
}

.player-car__lyric-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.85rem;
  text-align: center;
}

.player-car__line {
  margin: 0;
  max-width: 100%;
  line-height: 1.4;
}

.player-car__line.is-far {
  font-size: clamp(1.05rem, 2.1vw, 1.45rem);
  color: color-mix(in srgb, var(--mute) 72%, transparent);
}

.player-car__line.is-prev,
.player-car__line.is-next {
  font-size: clamp(1.25rem, 2.7vw, 1.8rem);
  color: var(--mute);
}

.player-car__line.is-now {
  font-size: clamp(1.85rem, 4vw, 2.7rem);
  font-weight: 500;
  color: var(--fg);
}

.player-car__seek {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: calc(100% - 12vw);
  margin: 0 auto;
  padding: 0.35rem 0 0.15rem;
  flex-shrink: 0;
}

.player-car__clock {
  width: 3.1rem;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.9rem;
  color: var(--mute);
  font-variant-numeric: tabular-nums;
}

.player-car__clock--end {
  text-align: right;
}

.player-groove--car {
  height: 5px;
}

.player-groove--car::-webkit-slider-thumb {
  opacity: 1;
  width: 14px;
  height: 14px;
}

.player-groove--car::-moz-range-thumb {
  opacity: 1;
  width: 14px;
  height: 14px;
}

.player-car__controls {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0.75rem 4vw calc(1.5rem + env(safe-area-inset-bottom, 0));
  flex-shrink: 0;
}

.player-car__transport {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.75rem;
}

.player-car__queue-btn {
  grid-column: 3;
  justify-self: end;
  position: relative;
}

.player-car__queue-btn .player-bar__badge {
  top: 0.45rem;
  right: 0.45rem;
  min-width: 1.1rem;
  font-size: 0.75rem;
  line-height: 1.25rem;
}

.player-car__btn {
  width: 4.6rem;
  height: 4.6rem;
  min-width: 4.6rem;
  font-size: 1.85rem;
  border: 1px solid var(--border);
  background: var(--elevated);
}

.player-car__hub {
  width: 5.6rem;
  height: 5.6rem;
  min-width: 5.6rem;
  min-height: 5.6rem;
  font-size: 2.2rem;
  border-width: 3px;
}

@keyframes player-now-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes player-pop {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 767px) {
  .player-bar {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'seek seek'
      'left right';
    gap: 0.15rem 0.5rem;
    min-height: 4.7rem;
    padding: 0.3rem max(0.7rem, var(--safe-r)) 0.35rem max(0.7rem, var(--safe-l));
  }

  .player-bar__vol {
    display: none;
  }

  .player-groove::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    opacity: 1;
  }

  .player-now__lyrics,
  .player-queue__list {
    overscroll-behavior: contain;
  }

  .player-bar__center {
    grid-area: seek;
    flex-direction: column-reverse;
  }

  .player-bar__transport {
    display: none;
  }

  .player-bar__left {
    grid-area: left;
  }

  .player-bar__right {
    grid-area: right;
  }

  .player-ctrl.player-bar__mplay {
    display: inline-flex;
  }

  .player-bar__ci {
    display: none;
  }

  .player-now__body {
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.35rem 1rem 0.75rem;
    align-items: center;
  }

  .player-now__disc {
    flex: 0 0 auto;
  }

  .player-now__title {
    font-size: 1.2rem;
  }

  .player-bar__seek {
    max-width: none;
  }

  .player-now {
    bottom: var(--chrome-bottom);
  }

  .player-now__modes {
    display: flex;
  }

  .player-now__lyric-col {
    width: 100%;
    max-width: none;
    height: auto;
    flex: 1;
  }

  .player-queue {
    right: 0.4rem;
    left: 0.4rem;
    width: auto;
    bottom: calc(var(--chrome-bottom) + 0.4rem);
  }

  .player-car__body {
    flex-direction: column;
    gap: 1rem;
    padding: 0.35rem 1.25rem 0.5rem;
  }

  .player-car__lyric-col {
    flex: 1;
    width: 100%;
    gap: 0.5rem;
  }

  .player-car__seek {
    width: calc(100% - 2.5rem);
  }

  .player-queue--car {
    bottom: calc(10.25rem + env(safe-area-inset-bottom, 0));
  }
}

@media (min-width: 768px) {
  .player-bar {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }

  .player-bar .player-hub {
    width: 2.15rem;
    height: 2.15rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-now,
  .player-car,
  .player-queue {
    animation: none;
  }

  .player-ctrl,
  .player-groove::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
