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
  <article class="bg-card text-ink p-5 md:p-8 min-h-80 flex flex-col gap-6">
    <header class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      <div>
        <p class="font-mono text-xs tracking-[0.16em] text-[#6b5346] m-0 flex items-center gap-1.5">
          <SourceIcon :source="playlist.source" :size="14" />
          {{ sourceLabels[playlist.source] }}
        </p>
        <h2 class="font-display text-4xl m-0 mt-1">{{ playlist.name }}</h2>
        <p class="font-mono text-xs mt-2 break-all text-[#5c4638]">{{ playlist.url }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3 min-w-60">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <Switch :checked="playlist.enabled" @change="(v) => emit('update:enabled', Boolean(v))" />
          <span>{{ playlist.enabled ? '加入定时同步' : '暂停定时' }}</span>
        </label>
        <a-button
          class="stamp !h-11 !px-5 !text-ink !inline-flex !items-center !gap-1.5"
          :disabled="!tracks.length"
          @click="onPlayPlaylist"
        >
          <span class="i-lucide-list-music" aria-hidden="true" />
          播放歌单
        </a-button>
        <a-button type="primary" class="stamp !h-11 !px-5 !text-ink" :loading="props.syncing" @click="press">
          同步
        </a-button>
      </div>
    </header>

    <ol v-if="tracks.length" class="list-none p-0 m-0 flex flex-col gap-1 stagger-in">
      <li
        v-for="(t, i) in tracks"
        :key="t.songKey"
        class="grid grid-cols-[2rem_1fr_auto] gap-3 items-start py-2 border-0 border-b border-solid border-[#d8c6a8]"
      >
        <span class="font-mono text-xs text-[#6b5346] pt-0.5">{{ String(i + 1).padStart(2, '0') }}</span>
        <span>
          <span class="block text-base">{{ t.name }}</span>
          <span class="text-sm text-[#5c4638]">{{ t.singer }} · {{ t.album }}</span>
        </span>
        <div class="font-mono text-xs flex flex-col items-end gap-1.5">
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
</style>
