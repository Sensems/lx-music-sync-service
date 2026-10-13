<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { LyricLine } from './types.js'

const props = withDefaults(
  defineProps<{
    lines: LyricLine[]
    activeIndex: number
    variant?: 'desk' | 'preview' | 'full' | 'car'
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

const followOnly = computed(() => props.variant === 'preview')
const highlightIndex = computed(() =>
  followOnly.value || !previewing.value ? props.activeIndex : previewIndex.value,
)
const scrubbing = computed(() => !followOnly.value && previewing.value)
const previewLine = computed(() => {
  if (!scrubbing.value) return null
  return props.lines[previewIndex.value] ?? null
})

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
let scrollAnim = 0
let scrollRelease: ReturnType<typeof setTimeout> | undefined

/** 正弦缓入缓出：邻行也不会先冲后刹 */
function easeInOutSine(t: number) {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

function cancelScrollAnim() {
  const held = scrollAnim !== 0 || scrollRelease !== undefined
  if (scrollAnim) {
    cancelAnimationFrame(scrollAnim)
    scrollAnim = 0
  }
  if (scrollRelease) {
    clearTimeout(scrollRelease)
    scrollRelease = undefined
  }
  if (held) programmatic = Math.max(0, programmatic - 1)
}

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
  // 封面预览只跟唱，手滑不改高亮、不出跳进度条
  previewIndex.value = followOnly.value ? -1 : nearestIndex()
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

function releaseProgrammatic() {
  scrollRelease = window.setTimeout(() => {
    scrollRelease = undefined
    programmatic = Math.max(0, programmatic - 1)
  }, 32)
}

function animateScroll(root: HTMLElement, top: number, smooth: boolean) {
  cancelScrollAnim()
  const dest = Math.max(0, top)
  programmatic += 1
  if (!smooth || reduceMotion() || Math.abs(dest - root.scrollTop) < 1) {
    root.scrollTop = dest
    releaseProgrammatic()
    return
  }
  const from = root.scrollTop
  const distance = dest - from
  const duration = Math.min(1200, Math.max(820, 760 + Math.abs(distance) * 0.85))
  const started = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / duration)
    root.scrollTop = from + distance * easeInOutSine(t)
    if (t < 1) {
      scrollAnim = requestAnimationFrame(step)
      return
    }
    scrollAnim = 0
    releaseProgrammatic()
  }
  scrollAnim = requestAnimationFrame(step)
}

function onListPointerDown() {
  // 手一碰就停掉跟唱滚动，避免动画还在跑时滑不动
  if (scrollAnim) {
    cancelScrollAnim()
    programmatic = 0
  }
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
  animateScroll(root, top, smooth)
}

function queueScroll(smooth: boolean) {
  void nextTick(() => {
    requestAnimationFrame(() => scrollToActive(smooth))
  })
}

function playPreview() {
  const line = previewLine.value
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
  cancelScrollAnim()
  programmatic = 0
  exitPreview()
})
</script>

<template>
  <div class="lyric-scroller" :class="`lyric-scroller--${variant}`">
    <div
      ref="rootEl"
      class="lyric-scroller__list"
      @pointerdown="onListPointerDown"
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
      </p>
    </div>
    <div v-if="previewLine" class="lyric-scroller__hud">
      <span class="lyric-scroller__clock">{{ formatClock(previewLine.time) }}</span>
      <button
        type="button"
        class="lyric-scroller__play"
        :aria-label="`从 ${formatClock(previewLine.time)} 播放`"
        @pointerdown.stop
        @click.stop="playPreview"
      >
        <span class="i-lucide-play lyric-scroller__play-icon" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.lyric-scroller {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  margin: 0 auto;
}

.lyric-scroller__list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent);
  padding: 0 1.25rem;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

/* 一半视口高的垫块，首尾行才能滚到中线被选中 */
.lyric-scroller__list::before,
.lyric-scroller__list::after {
  content: '';
  flex: 0 0 50%;
  pointer-events: none;
}

.lyric-scroller__list::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.lyric-scroller__empty {
  margin: 0;
  flex-shrink: 0;
  text-align: center;
  color: var(--mute);
}

.lyric-scroller__line {
  margin: 0;
  flex-shrink: 0;
  padding: 0.7rem 0.45rem;
  text-align: center;
  font-size: calc(1.18rem - 2px);
  line-height: 1.7;
  color: color-mix(in srgb, var(--fg) 42%, transparent);
  transition: color 0.88s cubic-bezier(0.37, 0, 0.63, 1);
}

.lyric-scroller__text {
  display: block;
  min-width: 0;
  transform: scale(0.985);
  transform-origin: center;
  transition: transform 0.88s cubic-bezier(0.37, 0, 0.63, 1);
}

.lyric-scroller__line.is-now {
  color: var(--fg);
}

.lyric-scroller__line.is-now .lyric-scroller__text {
  transform: scale(1.035);
}

.lyric-scroller__hud {
  position: absolute;
  left: 0.35rem;
  right: 0.35rem;
  top: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 2.45rem;
  padding: 0.2rem 0.7rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fg) 12%, transparent);
  transform: translateY(-50%);
  pointer-events: none;
}

.lyric-scroller__clock {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--fg) 62%, transparent);
  white-space: nowrap;
}

.lyric-scroller__play {
  appearance: none;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  min-width: 2.2rem;
  min-height: 2.2rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  line-height: 1;
}

.lyric-scroller__play-icon {
  font-size: 0.95rem;
}

.lyric-scroller__play:hover {
  color: var(--foil);
}

.lyric-scroller--preview {
  flex: 1 1 0;
  min-height: 0;
}

.lyric-scroller--preview .lyric-scroller__list {
  padding-left: 0.35rem;
  padding-right: 0.35rem;
}

.lyric-scroller--full .lyric-scroller__list {
  padding-left: 1.1rem;
  padding-right: 1.1rem;
}

.lyric-scroller--car {
  flex: 1 1 0;
  min-height: 0;
}

.lyric-scroller--car .lyric-scroller__list {
  padding-left: 0.4rem;
  padding-right: 0.4rem;
}

.lyric-scroller--car .lyric-scroller__empty {
  font-size: clamp(1.4rem, 3vw, 2rem);
}

.lyric-scroller--car .lyric-scroller__line {
  padding: 0.85rem 0.35rem;
  font-size: clamp(1.35rem, 2.8vw, 1.95rem);
  line-height: 1.45;
}

.lyric-scroller--car .lyric-scroller__line.is-now {
  font-weight: 500;
}

.lyric-scroller--car .lyric-scroller__text {
  transform: scale(0.97);
}

.lyric-scroller--car .lyric-scroller__line.is-now .lyric-scroller__text {
  transform: scale(1.08);
}

.lyric-scroller--car .lyric-scroller__hud {
  min-height: 3rem;
  padding: 0.25rem 0.9rem;
}

.lyric-scroller--car .lyric-scroller__play {
  width: 2.6rem;
  min-width: 2.6rem;
  min-height: 2.6rem;
}

.lyric-scroller--car .lyric-scroller__play-icon {
  font-size: 1.15rem;
}

@media (max-width: 767px) {
  .lyric-scroller--preview .lyric-scroller__list,
  .lyric-scroller--full .lyric-scroller__list {
    padding-left: 0.2rem;
    padding-right: 0.2rem;
  }

  .lyric-scroller--preview {
    flex: 1 1 0;
    min-height: 0;
  }

  .lyric-scroller--full {
    flex: 1 1 auto;
    min-height: 0;
  }

  .lyric-scroller--full .lyric-scroller__line {
    padding: 0.62rem 0.35rem;
    line-height: 1.65;
  }

  .lyric-scroller--preview .lyric-scroller__line {
    padding: 0.38rem 0.35rem;
    line-height: 1.55;
  }

  .lyric-scroller--car .lyric-scroller__list {
    padding-left: 0.15rem;
    padding-right: 0.15rem;
  }

  .lyric-scroller--car .lyric-scroller__line {
    padding: 0.62rem 0.2rem;
    font-size: clamp(1.15rem, 4.8vw, 1.55rem);
  }

  .lyric-scroller__hud {
    left: 0.15rem;
    right: 0.15rem;
    padding: 0.18rem 0.55rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lyric-scroller__line,
  .lyric-scroller__text {
    transition: none;
  }

  .lyric-scroller__line.is-now .lyric-scroller__text {
    transform: none;
  }

  .lyric-scroller__text {
    transform: none;
  }
}
</style>
