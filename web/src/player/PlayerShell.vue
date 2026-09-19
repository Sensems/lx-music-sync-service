<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { message } from 'ant-design-vue'
import { usePlayer } from './usePlayer'
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

const canSkip = computed(() => queue.value.length >= 2)

const progressMax = computed(() => {
  const d = duration.value
  return d > 0 && Number.isFinite(d) ? d : 0
})

const timeLabel = computed(() => {
  const cur = formatTime(currentTime.value)
  const total = progressMax.value > 0 ? formatTime(progressMax.value) : '--:--'
  return `${cur} / ${total}`
})

const loopLabel = computed(() => {
  if (loop.value === 'one') return '单曲'
  if (loop.value === 'all') return '列表'
  return '顺序'
})

watch(error, (msg) => {
  if (msg) message.error(msg)
})

watch(lyricIndex, async (i) => {
  if (i < 0) return
  await nextTick()
  const el = document.querySelector(`[data-lyric-line="${i}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
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

function toggleQueue() {
  showQueue.value = !showQueue.value
}

function onCarToggle() {
  if (carMode.value) exitCar()
  else enterCar()
}

function onFullBack() {
  if (carMode.value) exitCar()
  else collapse()
}
</script>

<template>
  <template v-if="current">
    <!-- 底条：未展开时显示，叠在任务条上方 -->
    <div
      v-if="!expanded"
      class="player-bar fixed left-0 right-0 z-30 border-0 border-t border-solid border-border bg-surface/95 cursor-pointer"
      role="button"
      tabindex="0"
      aria-label="展开播放器"
      @click="expand"
      @keydown.enter.prevent="expand"
      @keydown.space.prevent="expand"
    >
      <input
        class="player-bar__progress"
        type="range"
        min="0"
        :max="progressMax || 1"
        step="0.1"
        :value="currentTime"
        :disabled="progressMax <= 0"
        aria-label="播放进度"
        @click.stop
        @input="onSeek"
      />
      <div class="player-bar__row px-3 md:px-6 flex items-center gap-3">
        <div class="player-bar__meta flex items-center gap-3 min-w-0 flex-1">
          <div class="player-bar__cover shrink-0 overflow-hidden bg-elevated">
            <img v-if="current.picUrl" :src="current.picUrl" :alt="current.name" class="w-full h-full object-cover" />
            <span v-else class="i-lucide-disc-3 text-mute text-lg" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <p class="m-0 text-sm text-fg truncate">{{ current.name }}</p>
            <p class="m-0 text-xs text-mute truncate">{{ current.singer }}</p>
            <p v-if="error" class="m-0 text-xs text-rec truncate">{{ error }}</p>
          </div>
        </div>

        <button
          type="button"
          class="stamp hit-44 rounded-full bg-foil text-ink shrink-0"
          :aria-label="playing ? '暂停' : '播放'"
          @click.stop="toggle"
        >
          <span :class="playing ? 'i-lucide-pause' : 'i-lucide-play'" aria-hidden="true" />
        </button>

        <div class="player-bar__right flex items-center gap-2 shrink-0" @click.stop>
          <span class="font-mono text-xs text-mute hidden sm:inline">{{ timeLabel }}</span>
          <button type="button" class="stamp hit-44 text-sm text-foil px-2" @click="expand">
            展开
          </button>
        </div>
      </div>
    </div>

    <!-- 全屏播放器 -->
    <div
      v-else-if="!carMode"
      class="player-full fixed inset-0 z-40 bg-cabinet text-fg flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="全屏播放器"
    >
      <header class="player-full__head flex items-center justify-between gap-3 px-4 md:px-8 pt-4 pb-2">
        <button type="button" class="stamp hit-44 text-sm text-foil px-3" @click="onFullBack">返回</button>
        <p class="m-0 text-sm text-mute truncate flex-1 text-center">{{ current.name }}</p>
        <button type="button" class="stamp hit-44 text-sm text-foil px-3" @click="onCarToggle">车载</button>
      </header>

      <div class="player-full__body flex-1 min-h-0 px-4 md:px-10 pb-4 flex flex-col md:flex-row md:items-stretch gap-4 md:gap-8">
        <div class="player-full__cover-wrap flex flex-col items-center gap-3 md:w-[38%] md:justify-center">
          <div class="player-full__cover overflow-hidden bg-elevated">
            <img v-if="current.picUrl" :src="current.picUrl" :alt="current.name" class="w-full h-full object-cover" />
            <span v-else class="i-lucide-disc-3 text-mute text-5xl" aria-hidden="true" />
          </div>
          <div class="text-center max-w-full">
            <h2 class="m-0 font-display text-xl md:text-2xl text-fg truncate">{{ current.name }}</h2>
            <p class="m-0 mt-1 text-sm text-mute truncate">{{ current.singer }}</p>
            <p v-if="error" class="m-0 mt-1 text-xs text-rec">{{ error }}</p>
          </div>
        </div>

        <div class="player-full__lyrics flex-1 min-h-0 overflow-y-auto rounded-md bg-surface/40 px-3 py-4">
          <p v-if="lyricLines.length === 0" class="m-0 text-sm text-mute text-center py-8">暂无歌词</p>
          <p
            v-for="(line, i) in lyricLines"
            :key="`${line.time}-${i}`"
            :data-lyric-line="i"
            class="player-full__line m-0 py-1.5 text-center transition-colors"
            :class="i === lyricIndex ? 'text-foil text-base md:text-lg font-medium' : 'text-mute text-sm'"
          >
            {{ line.text || ' ' }}
          </p>
        </div>
      </div>

      <footer class="player-full__foot px-4 md:px-10 pb-6 pt-2 border-0 border-t border-solid border-border bg-surface/80">
        <div class="flex items-center gap-3 mb-3">
          <span class="font-mono text-xs text-mute w-10 tabular-nums">{{ formatTime(currentTime) }}</span>
          <input
            class="player-full__progress flex-1"
            type="range"
            min="0"
            :max="progressMax || 1"
            step="0.1"
            :value="currentTime"
            :disabled="progressMax <= 0"
            aria-label="播放进度"
            @input="onSeek"
          />
          <span class="font-mono text-xs text-mute w-10 text-right tabular-nums">{{
            progressMax > 0 ? formatTime(progressMax) : '--:--'
          }}</span>
        </div>

        <div class="player-full__controls flex flex-wrap items-center justify-center gap-2 md:gap-3">
          <button
            type="button"
            class="stamp hit-44 text-xs text-mute px-2"
            :class="loop !== 'off' ? 'text-foil' : ''"
            :title="`循环：${loopLabel}`"
            @click="cycleLoop"
          >
            <span v-if="loop === 'one'" class="i-lucide-repeat-1" aria-hidden="true" />
            <span v-else class="i-lucide-repeat" aria-hidden="true" />
            <span class="ml-1 hidden md:inline">{{ loopLabel }}</span>
          </button>

          <button
            type="button"
            class="stamp hit-44 rounded-full text-fg"
            :disabled="!canSkip"
            aria-label="上一首"
            @click="prev"
          >
            <span class="i-lucide-skip-back text-xl" aria-hidden="true" />
          </button>

          <button
            type="button"
            class="stamp hit-44 w-14 h-14 rounded-full bg-foil text-ink"
            :aria-label="playing ? '暂停' : '播放'"
            @click="toggle"
          >
            <span :class="playing ? 'i-lucide-pause text-2xl' : 'i-lucide-play text-2xl'" aria-hidden="true" />
          </button>

          <button
            type="button"
            class="stamp hit-44 rounded-full text-fg"
            :disabled="!canSkip"
            aria-label="下一首"
            @click="next"
          >
            <span class="i-lucide-skip-forward text-xl" aria-hidden="true" />
          </button>

          <button
            type="button"
            class="stamp hit-44 text-xs px-2"
            :class="shuffle ? 'text-foil' : 'text-mute'"
            aria-label="随机"
            @click="setShuffle(!shuffle)"
          >
            <span class="i-lucide-shuffle" aria-hidden="true" />
            <span class="ml-1 hidden md:inline">随机</span>
          </button>
        </div>

        <div class="player-full__extra mt-3 flex flex-wrap items-center justify-between gap-3">
          <div class="player-full__volume hidden md:flex items-center gap-2 min-w-40">
            <button
              type="button"
              class="stamp hit-44 text-mute"
              :aria-label="muted ? '取消静音' : '静音'"
              @click="toggleMute"
            >
              <span :class="muted || volume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" aria-hidden="true" />
            </button>
            <input
              class="player-full__vol-range flex-1"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="muted ? 0 : volume"
              aria-label="音量"
              @input="onVolume"
            />
          </div>

          <details class="player-full__more md:hidden">
            <summary class="stamp hit-44 text-sm text-foil list-none cursor-pointer px-2">更多</summary>
            <div class="mt-2 flex items-center gap-2 p-2 bg-elevated rounded-md">
              <button
                type="button"
                class="stamp hit-44 text-mute"
                :aria-label="muted ? '取消静音' : '静音'"
                @click="toggleMute"
              >
                <span :class="muted || volume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" aria-hidden="true" />
              </button>
              <input
                class="player-full__vol-range flex-1"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="muted ? 0 : volume"
                aria-label="音量"
                @input="onVolume"
              />
            </div>
          </details>

          <button type="button" class="stamp hit-44 text-sm text-foil px-3" @click="toggleQueue">
            队列 · {{ queue.length }}
          </button>
        </div>
      </footer>

      <!-- 队列抽屉 -->
      <aside
        v-if="showQueue"
        class="player-queue fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-surface border-0 border-l border-solid border-border flex flex-col shadow-lg"
        aria-label="播放队列"
      >
        <div class="flex items-center justify-between px-4 py-3 border-0 border-b border-solid border-border">
          <h3 class="m-0 text-base text-fg">队列</h3>
          <button type="button" class="stamp hit-44 text-sm text-mute px-2" @click="showQueue = false">关闭</button>
        </div>
        <ul class="m-0 p-0 list-none flex-1 overflow-y-auto">
          <li
            v-for="(item, i) in queue"
            :key="`${item.songKey}-${i}`"
            class="flex items-center gap-2 px-3 py-2 border-0 border-b border-solid border-border/50"
            :class="i === index ? 'bg-elevated' : ''"
          >
            <button
              type="button"
              class="stamp flex-1 min-w-0 text-left px-1 py-2"
              @click="jumpTo(i)"
            >
              <span class="block text-sm truncate" :class="i === index ? 'text-foil' : 'text-fg'">{{ item.name }}</span>
              <span class="block text-xs text-mute truncate">{{ item.singer }}</span>
            </button>
            <button
              type="button"
              class="stamp hit-44 text-mute shrink-0"
              aria-label="移出队列"
              @click="removeAt(i)"
            >
              <span class="i-lucide-x" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </aside>
      <div
        v-if="showQueue"
        class="fixed inset-0 z-40 bg-ink/40"
        aria-hidden="true"
        @click="showQueue = false"
      />
    </div>

    <!-- 车载模式 -->
    <div
      v-else
      class="player-car fixed inset-0 z-40 bg-cabinet text-fg flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="车载播放器"
    >
      <header class="flex items-center justify-between gap-3 px-4 md:px-8 pt-4 pb-2">
        <button type="button" class="stamp hit-44 text-base text-foil px-4" @click="exitCar">返回</button>
        <button type="button" class="stamp hit-44 text-base text-foil px-4" @click="exitCar">车载</button>
      </header>

      <div class="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6">
        <div class="player-car__cover overflow-hidden bg-elevated">
          <img v-if="current.picUrl" :src="current.picUrl" :alt="current.name" class="w-full h-full object-cover" />
          <span v-else class="i-lucide-disc-3 text-mute text-6xl" aria-hidden="true" />
        </div>
        <div class="text-center max-w-full">
          <h2 class="m-0 font-display text-2xl md:text-3xl text-fg truncate">{{ current.name }}</h2>
          <p class="m-0 mt-2 text-base text-mute truncate">{{ current.singer }}</p>
        </div>

        <div class="player-car__lyrics w-full max-w-lg text-center px-2 opacity-50">
          <p v-if="lyricLines.length === 0" class="m-0 text-sm text-mute">暂无歌词</p>
          <p v-else class="m-0 text-sm text-foil">
            {{ lyricIndex >= 0 ? lyricLines[lyricIndex]?.text || ' ' : '…' }}
          </p>
        </div>
      </div>

      <div class="player-car__controls flex items-center justify-center gap-8 md:gap-14 pb-12 pt-4">
        <button
          type="button"
          class="stamp player-car__btn rounded-full text-fg"
          :disabled="!canSkip"
          aria-label="上一首"
          @click="prev"
        >
          <span class="i-lucide-skip-back" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="stamp player-car__btn player-car__btn--main rounded-full bg-foil text-ink"
          :aria-label="playing ? '暂停' : '播放'"
          @click="toggle"
        >
          <span :class="playing ? 'i-lucide-pause' : 'i-lucide-play'" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="stamp player-car__btn rounded-full text-fg"
          :disabled="!canSkip"
          aria-label="下一首"
          @click="next"
        >
          <span class="i-lucide-skip-forward" aria-hidden="true" />
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.player-bar {
  bottom: 3.25rem;
}

.player-bar__progress,
.player-full__progress,
.player-full__vol-range {
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 80%, transparent);
  outline: none;
  cursor: pointer;
}

.player-bar__progress {
  display: block;
  margin: 0;
  border-radius: 0;
}

.player-bar__progress::-webkit-slider-thumb,
.player-full__progress::-webkit-slider-thumb,
.player-full__vol-range::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--foil);
  border: none;
  cursor: pointer;
}

.player-bar__progress::-moz-range-thumb,
.player-full__progress::-moz-range-thumb,
.player-full__vol-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--foil);
  border: none;
  cursor: pointer;
}

.player-bar__row {
  min-height: 3.5rem;
  padding-top: 0.35rem;
  padding-bottom: 0.35rem;
}

.player-bar__cover {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.player-full__cover {
  width: min(280px, 70vw);
  height: min(280px, 70vw);
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.player-car__cover {
  width: min(220px, 55vw);
  height: min(220px, 55vw);
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.player-car__btn {
  width: 4.5rem;
  height: 4.5rem;
  font-size: 1.75rem;
}

.player-car__btn--main {
  width: 5.5rem;
  height: 5.5rem;
  font-size: 2.25rem;
}

.player-full__more > summary::-webkit-details-marker {
  display: none;
}

@media (max-width: 767px) {
  .player-bar__row {
    min-height: 3rem;
    padding-top: 0.2rem;
    padding-bottom: 0.2rem;
  }

  .player-bar__cover {
    width: 2.25rem;
    height: 2.25rem;
  }

  .player-full__body {
    flex-direction: column;
  }

  .player-full__cover {
    width: min(160px, 42vw);
    height: min(160px, 42vw);
  }

  .player-full__controls .stamp {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }
}
</style>
