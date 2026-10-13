<script setup lang="ts">
import { computed } from 'vue'
import { message } from 'ant-design-vue'
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

const trackCount = computed(() => props.tracks.length || props.playlist.trackCount)
const downloadedCount = computed(() => props.tracks.filter(t => t.downloaded).length)

const emit = defineEmits<{
  press: []
  remove: [songId: string]
}>()

const { playList, playOne, enqueue } = usePlayer()

function toItem(t: Track): PlayItem {
  return {
    songKey: t.songKey,
    songId: t.songId,
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

function onRemoveTrack(t: Track) {
  if (!t.songId) return
  const ok = window.confirm(`从曲库去掉「${t.name}」？缓存会删掉。下次同步时，线上还有的歌会再出现。`)
  if (!ok) return
  emit('remove', t.songId)
}
</script>

<template>
  <article class="sleeve">
    <header class="sleeve-head">
      <p class="page-kicker sleeve-kicker">SLEEVE</p>
      <p class="sleeve-source">
        <SourceIcon :source="playlist.source" :size="14" />
        {{ sourceLabels[playlist.source] }}
      </p>
      <h2 class="sleeve-title">{{ playlist.name }}</h2>
      <p class="sleeve-url">{{ playlist.url }}</p>
      <p class="sleeve-count">{{ trackCount }} 首，已下载 {{ downloadedCount }}</p>
      <div class="sleeve-toolbar">
        <a-button
          class="stamp sleeve-btn sleeve-play"
          :disabled="!tracks.length"
          @click="onPlayPlaylist"
        >
          <span class="i-lucide-list-music" aria-hidden="true" />
          播放歌单
        </a-button>
        <div class="sleeve-tools">
          <a-button class="stamp sleeve-btn" :loading="props.syncing" @click="press">同步</a-button>
        </div>
      </div>
    </header>

    <ol v-if="tracks.length" class="sleeve-list stagger-in">
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
            <span v-if="t.downloaded" class="sleeve-row__ok">已下载</span>
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
            <button v-if="t.songId" type="button" class="sleeve-row-btn" @click="onRemoveTrack(t)">
              去掉
            </button>
          </span>
        </div>
      </li>
    </ol>
    <p v-else class="sleeve-empty">还没有曲目。点「同步」从线上拉取，并缓存还没有文件的歌。</p>
  </article>
</template>

<style scoped>
.sleeve {
  min-height: 20rem;
  padding: 1.15rem 1rem 1.25rem;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  transition:
    background-color 0.25s ease,
    color 0.25s ease,
    border-color 0.25s ease;
}

.sleeve-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-bottom: 1.15rem;
  border-bottom: 1px solid var(--border);
}

.sleeve-kicker {
  color: var(--mute);
}

.sleeve-source {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--mute);
}

.sleeve-title {
  margin: 0.35rem 0 0;
  font-family: 'ZCOOL XiaoWei', 'Noto Serif SC', serif;
  font-size: 2rem;
  line-height: 1.15;
  font-weight: 400;
  overflow-wrap: anywhere;
}

.sleeve-url,
.sleeve-count {
  margin: 0.45rem 0 0;
  color: var(--mute);
}

.sleeve-url {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.75rem;
}

.sleeve-count {
  font-size: 0.9rem;
}

.sleeve-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: 100%;
  margin-top: 1.05rem;
}

.sleeve-btn {
  height: 2.75rem !important;
  padding: 0 1.15rem !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 0.4rem !important;
  background: var(--wine) !important;
  border-color: var(--wine) !important;
  color: var(--card) !important;
}

.sleeve-btn:hover:not(:disabled) {
  border-color: var(--foil) !important;
}

.sleeve-btn:disabled {
  opacity: 0.4;
}

.sleeve-play {
  width: 100%;
}

.sleeve-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.sleeve-cron {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.sleeve-list {
  list-style: none;
  margin: 0;
  padding: 0.35rem 0 0;
}

.sleeve-empty {
  margin: 1.1rem 0 0;
  font-size: 0.9rem;
  color: var(--mute);
}

.sleeve-row {
  display: grid;
  grid-template-columns: 2rem 1fr auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.55rem 0;
  border: 0;
  border-bottom: 1px solid var(--border);
}

.sleeve-row__idx {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--mute);
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
  color: var(--mute);
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

.sleeve-row__ok,
.sleeve-row-btn:hover {
  color: var(--foil);
}

@media (max-width: 767px) {
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

@media (min-width: 768px) {
  .sleeve {
    padding: 1.75rem 2rem 2rem;
  }

  .sleeve-title {
    font-size: 2.35rem;
  }

  .sleeve-toolbar {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.75rem 1rem;
  }

  .sleeve-play {
    width: auto;
  }
}
</style>
