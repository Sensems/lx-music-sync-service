<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePlayer } from '../player/usePlayer'
import LyricScroller from '../player/LyricScroller.vue'
import PlayerSleeve from '../player/PlayerSleeve.vue'

const {
  current,
  playing,
  lyricLines,
  lyricIndex,
  error,
  carMode,
  collapse,
  enterCar,
  exitCar,
  seek,
  toggle,
} = usePlayer()

/** 移动端：封面页 / 多行歌词页，桌面端忽略 */
const lyricPage = ref(false)
const narrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)

const viewportEl = ref<HTMLElement | null>(null)
const dragX = ref(0)
const settling = ref(false)

const slides = computed(() => {
  const other = lyricPage.value ? 'cover' : 'lyrics'
  const cur = lyricPage.value ? 'lyrics' : 'cover'
  return [other, cur, other] as const
})

const deckStyle = computed(() => ({
  transform: `translate3d(calc(-100% + ${dragX.value}px), 0, 0)`,
}))

watch(current, item => {
  if (!item) collapse()
}, { immediate: true })

function onCarToggle() {
  if (carMode.value) exitCar()
  else enterCar()
}

function playFrom(time: number) {
  seek(time)
  if (!playing.value) toggle()
}

function reduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function viewportWidth() {
  return viewportEl.value?.clientWidth || window.innerWidth || 320
}

let settleTimer: ReturnType<typeof setTimeout> | undefined
let dragging = false
let locked: 'x' | 'y' | null = null
let startX = 0
let startY = 0
let lastX = 0
let lastT = 0
let velX = 0

function clearSettle() {
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = undefined
  }
}

function finishSwitch() {
  settling.value = false
  lyricPage.value = !lyricPage.value
  dragX.value = 0
}

function settleTo(nextX: number, switched: boolean) {
  if (reduceMotion()) {
    dragX.value = 0
    settling.value = false
    if (switched) lyricPage.value = !lyricPage.value
    return
  }
  settling.value = true
  dragX.value = nextX
  clearSettle()
  settleTimer = setTimeout(() => {
    settleTimer = undefined
    if (switched) finishSwitch()
    else {
      settling.value = false
      dragX.value = 0
    }
  }, 320)
}

function goBy(dir: -1 | 1) {
  if (settling.value) return
  settleTo(dir * viewportWidth(), true)
}

function onSwipeStart(ev: PointerEvent) {
  if (!narrow.value || settling.value) return
  dragging = true
  locked = null
  startX = lastX = ev.clientX
  startY = ev.clientY
  lastT = performance.now()
  velX = 0
  dragX.value = 0
  ;(ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId)
}

function onSwipeMove(ev: PointerEvent) {
  if (!dragging) return
  const dx = ev.clientX - startX
  const dy = ev.clientY - startY
  if (!locked) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    locked = Math.abs(dx) > Math.abs(dy) * 1.05 ? 'x' : 'y'
  }
  if (locked !== 'x') return
  ev.preventDefault()
  const now = performance.now()
  const dt = Math.max(now - lastT, 8)
  velX = (ev.clientX - lastX) / dt
  lastX = ev.clientX
  lastT = now
  dragX.value = dx
}

function onSwipeEnd() {
  if (!dragging) return
  dragging = false
  if (locked !== 'x') {
    locked = null
    dragX.value = 0
    return
  }
  locked = null
  const w = viewportWidth()
  const shouldFlip = Math.abs(dragX.value) > w * 0.18 || Math.abs(velX) > 0.4
  if (!shouldFlip) {
    settleTo(0, false)
    return
  }
  const dir: -1 | 1 = dragX.value < 0 || (dragX.value === 0 && velX < 0) ? -1 : 1
  goBy(dir)
}

function onSwipeCancel() {
  dragging = false
  locked = null
  if (!settling.value) dragX.value = 0
}

let stopMq: (() => void) | undefined

onMounted(() => {
  const mq = window.matchMedia('(max-width: 767px)')
  const apply = () => {
    narrow.value = mq.matches
    if (!mq.matches) {
      lyricPage.value = false
      dragX.value = 0
      settling.value = false
    }
  }
  apply()
  mq.addEventListener('change', apply)
  stopMq = () => mq.removeEventListener('change', apply)
})

onUnmounted(() => {
  lyricPage.value = false
  clearSettle()
  stopMq?.()
})
</script>

<template>
  <div v-if="current && !carMode" class="now" :class="lyricPage ? 'now--lyrics' : ''">
    <div
      class="now__bg"
      :style="current.picUrl ? { backgroundImage: `url(${current.picUrl})` } : undefined"
      aria-hidden="true"
    />
    <div class="now__shade" aria-hidden="true" />

    <div class="now__head">
      <button type="button" class="now__fold" aria-label="收起" @click="collapse">
        <span class="i-lucide-chevron-down text-xl" aria-hidden="true" />
      </button>
      <button type="button" class="now__car" @click="onCarToggle">
        <span class="i-lucide-car-front text-lg" aria-hidden="true" />
        车载
      </button>
    </div>

    <div v-if="!narrow" class="now__body">
      <div class="now__stage">
        <div class="now__disc now__disc--desk">
          <PlayerSleeve variant="disc" :pic-url="current.picUrl" :name="current.name" :playing="playing" />
        </div>
        <div class="now__heading-text">
          <h2 class="now__title">{{ current.name }}</h2>
          <p class="now__artist">{{ current.singer }}</p>
        </div>
        <p v-if="error" class="now__err">
          <span class="i-lucide-circle-alert" aria-hidden="true" />
          {{ error }}
        </p>
      </div>
      <div class="now__lyric-col">
        <LyricScroller
          variant="desk"
          :lines="lyricLines"
          :active-index="lyricIndex"
          :active="true"
          :playing="playing"
          @play="playFrom"
        />
      </div>
    </div>

    <div
      v-else
      ref="viewportEl"
      class="now__viewport"
      @pointerdown="onSwipeStart"
      @pointermove="onSwipeMove"
      @pointerup="onSwipeEnd"
      @pointercancel="onSwipeCancel"
    >
      <div class="now__deck" :class="{ 'is-settle': settling }" :style="deckStyle">
        <section v-for="(kind, i) in slides" :key="`${kind}-${i}`" class="now__slide">
          <div v-if="kind === 'cover'" class="now__pane now__pane--cover">
            <div class="now__cover">
              <PlayerSleeve variant="cover" :pic-url="current.picUrl" :name="current.name" :playing="playing" />
            </div>
            <div class="now__heading-text">
              <h2 class="now__title">{{ current.name }}</h2>
              <p class="now__artist">{{ current.singer }}</p>
            </div>
            <p v-if="error" class="now__err">
              <span class="i-lucide-circle-alert" aria-hidden="true" />
              {{ error }}
            </p>
            <LyricScroller
              variant="preview"
              :lines="lyricLines"
              :active-index="lyricIndex"
              :active="i === 1"
              :playing="playing"
            />
          </div>
          <div v-else class="now__pane now__pane--lyrics">
            <div class="now__heading">
              <button
                type="button"
                class="now__cover-chip"
                aria-label="返回封面"
                @pointerdown.stop
                @click="goBy(1)"
              >
                <img v-if="current.picUrl" :src="current.picUrl" :alt="current.name" />
                <span v-else class="i-lucide-disc-3" aria-hidden="true" />
              </button>
              <div class="now__heading-text">
                <h2 class="now__title">{{ current.name }}</h2>
                <p class="now__artist">{{ current.singer }}</p>
              </div>
            </div>
            <p v-if="error" class="now__err">
              <span class="i-lucide-circle-alert" aria-hidden="true" />
              {{ error }}
            </p>
            <LyricScroller
              variant="full"
              :lines="lyricLines"
              :active-index="lyricIndex"
              :active="i === 1"
              :playing="playing"
              @play="playFrom"
            />
          </div>
        </section>
      </div>
      <div class="now__dots" aria-hidden="true">
        <i :class="!lyricPage ? 'is-on' : ''" />
        <i :class="lyricPage ? 'is-on' : ''" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.now {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  overflow: clip;
  padding-top: env(safe-area-inset-top, 0);
  background: var(--cabinet);
  animation: now-in 0.28s ease-out;
}

.now__bg {
  position: absolute;
  inset: 0;
  background: var(--cabinet) center / cover no-repeat;
  filter: blur(60px) saturate(1.2);
  transform: scale(1.12);
  opacity: 0.55;
  pointer-events: none;
}

.now__shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    color-mix(in srgb, var(--cabinet) 82%, transparent),
    color-mix(in srgb, #000 28%, transparent);
}

.now::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(var(--player-h) + 2.25rem);
  pointer-events: none;
  z-index: 2;
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--cabinet) 58%, transparent)
  );
}

.now__head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.05rem 1.35rem 0;
}

.now__fold,
.now__car {
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
  font: inherit;
}

.now__car {
  font-size: 0.85rem;
}

.now__fold:hover,
.now__car:hover {
  color: var(--foil);
}

.now__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(16rem, 0.72fr) minmax(26rem, 1.4fr);
  align-items: stretch;
  gap: clamp(1.4rem, 4vw, 3.25rem);
  padding: 0.4rem clamp(1.5rem, 5vw, 4.5rem) var(--player-h);
}

.now__stage {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1.15rem;
  min-width: 0;
}

.now__cover,
.now__cover-chip {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
}

.now__cover {
  display: none;
}

.now__cover-chip {
  display: none;
  cursor: pointer;
}

.now__lyric-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.now__stage .now__title {
  font-size: clamp(1.55rem, 2.3vw, 2.2rem);
}

.now__stage .now__artist {
  margin-bottom: 0;
  font-size: 1rem;
}

.now__heading-text {
  min-width: 0;
}

.now__title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 500;
  text-align: center;
}

.now__artist {
  margin: 0.45rem 0 1rem;
  text-align: center;
  color: var(--mute);
  font-size: 0.9rem;
}

.now__err {
  margin: 0 0 0.75rem;
  text-align: center;
  color: var(--rec);
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
}

.now__cover-chip {
  width: 3.4rem;
  height: 3.4rem;
  border-radius: 0.45rem;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--elevated);
  box-shadow: 0 8px 20px color-mix(in srgb, #000 36%, transparent);
}

.now__cover-chip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

@keyframes now-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 767px) {
  .now__head {
    padding: 1.05rem 0.9rem 0.2rem;
  }

  .now__viewport {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding-bottom: var(--player-h);
    touch-action: pan-y;
  }

  .now__deck {
    display: flex;
    height: 100%;
    width: 100%;
    will-change: transform;
  }

  .now__deck.is-settle {
    transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .now__slide {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .now__pane {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0.45rem 1.15rem 0.2rem;
  }

  .now__pane--cover {
    overflow: hidden;
  }

  .now__pane--cover .now__heading-text,
  .now__pane--cover .now__err {
    flex-shrink: 0;
  }

  .now__pane--cover :deep(.lyric-scroller) {
    flex: 0 0 auto;
    height: clamp(4.25rem, calc(100dvh - var(--player-h) - 22.5rem), 7.4rem);
    min-height: 0;
  }

  .now__cover {
    display: block;
    margin: 0.15rem auto 0.45rem;
    flex: 0 1 auto;
    min-height: 0;
  }

  .now__heading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
  }

  .now__pane--lyrics .now__heading-text {
    text-align: left;
  }

  .now__pane--lyrics .now__title,
  .now__pane--lyrics .now__artist {
    text-align: left;
  }

  .now__pane--lyrics .now__cover-chip {
    display: block;
  }

  .now__title {
    font-size: 1.2rem;
  }

  .now__artist {
    margin-bottom: 0.35rem;
  }

  .now__dots {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--player-h) + 0.15rem);
    z-index: 3;
    display: flex;
    justify-content: center;
    gap: 0.35rem;
    pointer-events: none;
  }

  .now__dots i {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 28%, transparent);
  }

  .now__dots i.is-on {
    width: 0.85rem;
    background: var(--foil);
  }
}

@media (prefers-reduced-motion: reduce) {
  .now {
    animation: none;
  }

  .now__deck.is-settle {
    transition: none;
  }
}
</style>
