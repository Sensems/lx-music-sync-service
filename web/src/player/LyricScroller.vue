<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { LyricLine } from './types.js'

const props = withDefaults(
  defineProps<{
    lines: LyricLine[]
    activeIndex: number
    variant?: 'desk' | 'preview' | 'full'
    active?: boolean
    playing?: boolean
  }>(),
  {
    variant: 'desk',
    active: true,
    playing: true,
  },
)

const emit = defineEmits<{
  play: [time: number]
}>()

const rootEl = ref<HTMLElement | null>(null)
const previewing = ref(false)
const previewIndex = ref(-1)

const highlightIndex = computed(() => (previewing.value ? previewIndex.value : props.activeIndex))

function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function reduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

let programmatic = 0
let returnTimer: ReturnType<typeof setTimeout> | undefined
let settleTimer: ReturnType<typeof setTimeout> | undefined

function clearReturn() {
  if (returnTimer) {
    clearTimeout(returnTimer)
    returnTimer = undefined
  }
}

function clearSettle() {
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = undefined
  }
}

function exitPreview() {
  previewing.value = false
  previewIndex.value = -1
  clearReturn()
  clearSettle()
}

function nearestIndex(): number {
  const root = rootEl.value
  if (!root || props.lines.length === 0) return -1
  const mid = root.getBoundingClientRect().top + root.clientHeight / 2
  let best = 0
  let bestDist = Infinity
  for (const node of root.querySelectorAll('[data-lyric-line]')) {
    if (!(node instanceof HTMLElement)) continue
    const i = Number(node.dataset.lyricLine)
    if (!Number.isFinite(i)) continue
    const rect = node.getBoundingClientRect()
    const dist = Math.abs(rect.top + rect.height / 2 - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

function startReturnTimer() {
  clearReturn()
  // 暂停时让人慢慢看，不抢回正在播的那一行
  if (!previewing.value || !props.playing) return
  returnTimer = setTimeout(() => {
    returnTimer = undefined
    if (!previewing.value || !props.playing) return
    exitPreview()
    scrollToActive(true)
  }, 3000)
}

function onUserScroll() {
  if (programmatic > 0 || !props.active || props.lines.length === 0) return
  previewing.value = true
  previewIndex.value = nearestIndex()
  clearReturn()
  clearSettle()
  // scrollend 未到时先靠短延时判断停手，再开始三秒回位
  settleTimer = setTimeout(() => {
    settleTimer = undefined
    startReturnTimer()
  }, 140)
}

function onScrollEnd() {
  if (programmatic > 0 || !previewing.value) return
  clearSettle()
  startReturnTimer()
}

function scrollToActive(smooth: boolean) {
  const root = rootEl.value
  const i = props.activeIndex
  if (!props.active || !root || i < 0) return
  const el = root.querySelector(`[data-lyric-line="${i}"]`)
  if (!(el instanceof HTMLElement)) return
  const rootRect = root.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const top =
    root.scrollTop + (elRect.top + elRect.height / 2) - (rootRect.top + root.clientHeight / 2)
  programmatic += 1
  root.scrollTo({
    top,
    behavior: reduceMotion() || !smooth ? 'auto' : 'smooth',
  })
  let released = false
  const release = () => {
    if (released) return
    released = true
    root.removeEventListener('scrollend', release)
    window.setTimeout(() => {
      programmatic = Math.max(0, programmatic - 1)
    }, 32)
  }
  root.addEventListener('scrollend', release)
  window.setTimeout(release, reduceMotion() || !smooth ? 80 : 480)
}

function queueScroll(smooth: boolean) {
  void nextTick(() => {
    requestAnimationFrame(() => scrollToActive(smooth))
  })
}

function playLine(i: number) {
  const line = props.lines[i]
  if (!line) return
  exitPreview()
  emit('play', line.time)
  queueScroll(true)
}

watch(
  () => props.activeIndex,
  () => {
    if (previewing.value || !props.active) return
    queueScroll(true)
  },
)

watch(
  () => props.lines,
  () => {
    exitPreview()
    if (props.active) queueScroll(false)
  },
)

watch(
  () => props.active,
  on => {
    if (!on) {
      exitPreview()
      return
    }
    queueScroll(false)
  },
)

watch(
  () => props.playing,
  on => {
    if (!previewing.value) return
    if (on) startReturnTimer()
    else clearReturn()
  },
)

onMounted(() => {
  if (props.active) queueScroll(false)
})

onUnmounted(() => {
  exitPreview()
})
</script>

<template>
  <div
    ref="rootEl"
    class="lyric-scroller"
    :class="`lyric-scroller--${variant}`"
    @scroll.passive="onUserScroll"
    @scrollend="onScrollEnd"
  >
    <p v-if="lines.length === 0" class="lyric-scroller__empty">暂无歌词</p>
    <p
      v-for="(line, i) in lines"
      :key="`${line.time}-${i}`"
      :data-lyric-line="i"
      class="lyric-scroller__line"
      :class="i === highlightIndex ? 'is-now' : ''"
    >
      <span class="lyric-scroller__text">{{ line.text || ' ' }}</span>
      <button
        v-if="previewing && i === previewIndex"
        type="button"
        class="lyric-scroller__play"
        :aria-label="`从 ${formatClock(line.time)} 播放`"
        @pointerdown.stop
        @click.stop="playLine(i)"
      >
        <span class="i-lucide-play lyric-scroller__play-icon" aria-hidden="true" />
        {{ formatClock(line.time) }}
      </button>
    </p>
  </div>
</template>

<style scoped>
.lyric-scroller {
  position: relative;
  flex: 1;
  min-height: 0;
  width: min(38rem, 100%);
  margin: 0 auto;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent);
  padding: 18vh 3.25rem;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.lyric-scroller::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.lyric-scroller__empty {
  margin: 3rem 0 0;
  text-align: center;
  color: var(--mute);
}

.lyric-scroller__line {
  position: relative;
  margin: 0;
  padding: 0.7rem 0.45rem;
  text-align: center;
  font-size: 1.18rem;
  line-height: 1.7;
  color: color-mix(in srgb, var(--fg) 42%, transparent);
  transition: color 0.2s ease, font-size 0.2s ease;
}

.lyric-scroller__text {
  display: block;
}

.lyric-scroller__line.is-now {
  color: var(--fg);
  font-size: 1.68rem;
  font-weight: 500;
}

.lyric-scroller__play {
  appearance: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  min-height: 1.7rem;
  padding: 0.12rem 0.55rem 0.12rem 0.42rem;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fg) 14%, transparent);
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
}

.lyric-scroller__play-icon {
  font-size: 0.7rem;
}

.lyric-scroller__play:hover {
  color: var(--foil);
  background: color-mix(in srgb, var(--fg) 20%, transparent);
}

.lyric-scroller--preview {
  padding: 2.6rem 2.75rem;
}

.lyric-scroller--full {
  padding: 1.5rem 3rem;
}

@media (max-width: 767px) {
  .lyric-scroller--preview,
  .lyric-scroller--full {
    flex: 1 1 auto;
    min-height: 11.5rem;
    padding-left: 0.55rem;
    padding-right: 0.55rem;
  }

  .lyric-scroller__line {
    display: grid;
    grid-template-columns: 4.6rem minmax(0, 1fr) 4.6rem;
    align-items: center;
    column-gap: 0.2rem;
    font-size: 1.18rem;
    padding: 0.62rem 0;
    line-height: 1.65;
  }

  .lyric-scroller__text {
    grid-column: 2;
    min-width: 0;
  }

  .lyric-scroller__line.is-now {
    font-size: 1.48rem;
  }

  .lyric-scroller__play {
    position: static;
    transform: none;
    grid-column: 3;
    justify-self: end;
    min-height: 1.85rem;
    padding: 0.16rem 0.48rem 0.16rem 0.38rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lyric-scroller__line {
    transition: none;
  }
}
</style>
