<script setup lang="ts">
import { Switch, message } from 'ant-design-vue'
import type { Playlist, Track } from '../mock/data'
import { sourceLabels } from '../mock/data'
import SourceIcon from './SourceIcon.vue'
import { usePlayer } from '../player/usePlayer'
import type { PlayItem } from '../player/types'

const props = defineProps<{
  playlist: Playlist
  tracks: Track[]
  syncing?: boolean
}>()

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  press: []
}>()

const { playList, playOne, enqueue } = usePlayer()

function toItem(t: Track): PlayItem {
  return {
    songKey: t.songKey,
    name: t.name,
    singer: t.singer,
    picUrl: t.picUrl || '',
    source: String(t.musicInfo?.source || ''),
    musicInfo: t.musicInfo ?? null,
  }
}

function press() {
  emit('press')
}

async function onPlayPlaylist() {
  if (!props.tracks.length) return
  await playList(props.tracks.map(toItem))
}

async function onPlayTrack(t: Track) {
  await playOne(toItem(t))
}

function onEnqueueTrack(t: Track) {
  const { added, started } = enqueue(toItem(t))
  if (!added) message.info('已经在队列里')
  else if (!started) message.success('已加入队列')
}
</script>

<template>
  <article class="bg-card text-ink p-4 sm:p-5 md:p-8 min-h-80 flex flex-col gap-5 md:gap-6">
    <header class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-[#6b5346] m-0 flex items-center gap-1.5">
          <SourceIcon :source="playlist.source" :size="14" />
          {{ sourceLabels[playlist.source] }}
        </p>
        <h2 class="font-display text-3xl md:text-4xl m-0 mt-1 break-words">{{ playlist.name }}</h2>
        <p class="sleeve-url font-mono text-xs mt-2 text-[#5c4638]">{{ playlist.url }}</p>
      </div>
      <div class="sleeve-actions">
        <label class="flex items-center gap-2 text-sm cursor-pointer min-h-11">
          <Switch :checked="playlist.enabled" @change="(v) => emit('update:enabled', Boolean(v))" />
          <span>{{ playlist.enabled ? '加入定时同步' : '暂停定时' }}</span>
        </label>
        <a-button
          class="stamp !h-11 !px-5 !text-ink !inline-flex !items-center !gap-1.5 !flex-1 sm:!flex-none"
          :disabled="!tracks.length"
          @click="onPlayPlaylist"
        >
          <span class="i-lucide-list-music" aria-hidden="true" />
          播放歌单
        </a-button>
        <a-button type="primary" class="stamp !h-11 !px-5 !text-ink !flex-1 sm:!flex-none" :loading="props.syncing" @click="press">
          同步
        </a-button>
      </div>
    </header>

    <ol v-if="tracks.length" class="list-none p-0 m-0 flex flex-col gap-1 stagger-in">
      <li
        v-for="(t, i) in tracks"
        :key="t.songKey"
        class="sleeve-row"
      >
        <span class="sleeve-row__idx">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="sleeve-row__meta min-w-0">
          <span class="sleeve-row__name">{{ t.name }}</span>
          <span class="sleeve-row__sub">{{ t.singer }} · {{ t.album }}</span>
        </span>
        <div class="sleeve-row__ops">
          <span>
            <span v-if="t.downloaded" class="text-[#3d4a2a]">已下载</span>
            <span v-else class="text-rec">未下载</span>
          </span>
          <span class="flex gap-2">
            <button type="button" class="sleeve-row-btn" @click="onPlayTrack(t)">
              <span class="i-lucide-play" aria-hidden="true" />
              播放
            </button>
            <button type="button" class="sleeve-row-btn" @click="onEnqueueTrack(t)">
              <span class="i-lucide-list-plus" aria-hidden="true" />
              加入队列
            </button>
          </span>
        </div>
      </li>
    </ol>
    <p v-else class="text-sm text-[#5c4638] m-0">还没有曲目列表。点「同步」从线上拉取。</p>
  </article>
</template>

<style scoped>
.sleeve-url {
  margin: 0.5rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sleeve-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.sleeve-row {
  display: grid;
  grid-template-columns: 2rem 1fr auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.55rem 0;
  border: 0;
  border-bottom: 1px solid #d8c6a8;
}

.sleeve-row__idx {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: #6b5346;
  padding-top: 0.2rem;
}

.sleeve-row__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sleeve-row__sub {
  display: block;
  font-size: 0.875rem;
  color: #5c4638;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sleeve-row__ops {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.sleeve-row-btn {
  appearance: none;
  padding: 0.15rem 0.25rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-height: 2.5rem;
}

.sleeve-row-btn:hover {
  color: #3d4a2a;
}

@media (max-width: 767px) {
  .sleeve-actions {
    width: 100%;
  }

  .sleeve-row {
    grid-template-columns: 1.6rem 1fr;
    gap: 0.45rem 0.6rem;
    padding: 0.7rem 0;
  }

  .sleeve-row__ops {
    grid-column: 2;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
}
</style>
