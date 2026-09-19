<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Input, Spin, message } from 'ant-design-vue'
import { api } from '../api'
import SourceIcon from '../components/SourceIcon.vue'
import type { SourceId } from '../mock/data'
import { sourceLabels } from '../mock/data'
import { usePlayer } from '../player/usePlayer'
import type { PlayItem } from '../player/types'

type WallSong = {
  song_key: string
  name: string
  singer: string
  source: string
  pic_url: string
  quality: string
  file_path: string
  source_kind: string
  completed_at: number
}

const { playOne, enqueue } = usePlayer()

const songs = ref<WallSong[]>([])
const loading = ref(true)
const q = ref('')
const selectedKey = ref('')
const coverBroken = ref<Record<string, boolean>>({})

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return songs.value
  return songs.value.filter(s => {
    const hay = `${s.name} ${s.singer} ${s.source}`.toLowerCase()
    return hay.includes(needle)
  })
})

function toItem(song: WallSong): PlayItem {
  return {
    songKey: song.song_key,
    name: song.name,
    singer: song.singer,
    picUrl: song.pic_url,
    source: song.source,
    musicInfo: null,
  }
}

function markBroken(key: string) {
  coverBroken.value = { ...coverBroken.value, [key]: true }
}

function coverOf(song: WallSong): string {
  if (coverBroken.value[song.song_key] || !song.pic_url) return ''
  return song.pic_url
}

function toggleSelect(song: WallSong) {
  selectedKey.value = selectedKey.value === song.song_key ? '' : song.song_key
}

function clearSelectionIfOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.wall-card')) selectedKey.value = ''
}

async function onPlay(song: WallSong) {
  await playOne(toItem(song))
  selectedKey.value = ''
}

function onEnqueue(song: WallSong) {
  const { added, started } = enqueue(toItem(song))
  if (!added) message.info('已经在队列里')
  else if (!started) message.success('已加入队列')
}

async function load() {
  loading.value = true
  try {
    const body = await api.downloads()
    songs.value = (body.list ?? []).map((r: Record<string, unknown>) => ({
      song_key: String(r.song_key),
      name: String(r.name || r.song_key),
      singer: String(r.singer || '未知歌手'),
      source: String(r.source || ''),
      pic_url: String(r.pic_url || ''),
      quality: String(r.quality || ''),
      file_path: String(r.file_path || ''),
      source_kind: String(r.source_kind || ''),
      completed_at: Number(r.completed_at || 0),
    }))
    const missing = songs.value.some(s => !s.pic_url)
    if (missing) {
      void api
        .backfillCovers()
        .then(async res => {
          if (res.updated > 0) {
            const again = await api.downloads()
            songs.value = (again.list ?? []).map((r: Record<string, unknown>) => ({
              song_key: String(r.song_key),
              name: String(r.name || r.song_key),
              singer: String(r.singer || '未知歌手'),
              source: String(r.source || ''),
              pic_url: String(r.pic_url || ''),
              quality: String(r.quality || ''),
              file_path: String(r.file_path || ''),
              source_kind: String(r.source_kind || ''),
              completed_at: Number(r.completed_at || 0),
            }))
          }
        })
        .catch(() => {
          /* ignore */
        })
    }
  } catch {
    message.error('加载唱片墙失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="wall-page" @click="clearSelectionIfOutside">
    <header class="wall-hero">
      <div>
        <p class="wall-kicker">LIBRARY</p>
        <h2 class="font-display text-3xl md:text-5xl m-0">唱片墙</h2>
        <p class="text-mute mt-2 max-w-xl m-0">
          已下载到本地的歌曲会显示在这里。点封面会出现播放。
        </p>
      </div>
      <div class="wall-stats">
        <span class="wall-stat">
          <em>{{ songs.length }}</em>
          已下载
        </span>
        <span class="wall-stat">
          <em>{{ filtered.length }}</em>
          当前显示
        </span>
      </div>
    </header>

    <div class="wall-toolbar">
      <label class="wall-search">
        <span class="sr-only">搜歌名、歌手或平台</span>
        <Input
          v-model:value="q"
          allow-clear
          placeholder="搜歌名 / 歌手 / 平台"
          autocomplete="off"
          name="wall-q"
          inputmode="search"
        />
      </label>
    </div>

    <Spin :spinning="loading">
      <div v-if="filtered.length" class="wall-grid stagger-in">
        <div
          v-for="(song, idx) in filtered"
          :key="song.song_key"
          class="wall-card"
          :style="{ '--i': String(idx % 12) }"
          @click.stop
        >
          <div class="wall-sleeve">
            <div class="wall-vinyl" aria-hidden="true" />
            <div
              class="wall-cover"
              :class="{ 'wall-cover--selected': selectedKey === song.song_key }"
              role="button"
              tabindex="0"
              @click="toggleSelect(song)"
              @keydown.enter.prevent="toggleSelect(song)"
              @keydown.space.prevent="toggleSelect(song)"
            >
              <img
                v-if="coverOf(song)"
                class="wall-cover__img"
                :src="coverOf(song)"
                :alt="song.name"
                loading="lazy"
                @error="markBroken(song.song_key)"
              />
              <div v-else class="wall-cover__empty">
                <span>{{ (song.name || '?').slice(0, 1) }}</span>
              </div>
              <SourceIcon class="wall-card__badge" :source="song.source" :size="20" />
              <div
                v-if="selectedKey === song.song_key"
                class="wall-cover-actions"
                @click.stop
              >
                <button type="button" class="wall-cover-actions__btn wall-cover-actions__btn--play" @click.stop="onPlay(song)">
                  <span class="i-lucide-play" aria-hidden="true" />
                  播放
                </button>
                <button type="button" class="wall-cover-actions__btn" @click.stop="onEnqueue(song)">
                  <span class="i-lucide-list-plus" aria-hidden="true" />
                  加入队列
                </button>
              </div>
            </div>
          </div>
          <div class="wall-card__meta">
            <p class="wall-card__name">{{ song.name }}</p>
            <p class="wall-card__singer">{{ song.singer }}</p>
            <p class="wall-card__sub">
              {{ sourceLabels[song.source as SourceId] || song.source || '未知源' }}
              <span v-if="song.quality"> · {{ song.quality }}</span>
            </p>
          </div>
        </div>
      </div>
      <div v-else-if="!loading" class="wall-empty">
        <p class="font-display text-3xl text-fg m-0">还没有下载的歌曲</p>
        <p class="text-mute">去搜索下载一首，或在歌单里点同步。</p>
      </div>
    </Spin>
  </section>
</template>

<style scoped>
.wall-page {
  max-width: 1120px;
}

.wall-hero {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
  justify-content: space-between;
  align-items: end;
  margin-bottom: 1.25rem;
}

.wall-kicker {
  margin: 0 0 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.28em;
  color: var(--mute);
}

.wall-stats {
  display: flex;
  gap: 0.75rem;
}

.wall-stat {
  display: inline-flex;
  flex-direction: column;
  min-width: 5.5rem;
  padding: 0.65rem 0.9rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--mute);
  font-size: 0.75rem;
}

.wall-stat em {
  font-style: normal;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.75rem;
  line-height: 1.1;
  color: var(--foil);
}

.wall-toolbar {
  margin-bottom: 1.35rem;
}

.wall-search {
  display: block;
  width: 100%;
  max-width: 22rem;
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 1.35rem 1rem;
}

.wall-card {
  --i: 0;
  color: inherit;
  text-align: left;
  cursor: default;
  padding: 0;
  animation: wall-rise 0.45s ease both;
  animation-delay: calc(var(--i) * 35ms);
}

.wall-sleeve {
  position: relative;
  padding-right: 10px;
}

.wall-vinyl {
  position: absolute;
  inset: 8% 0 8% auto;
  width: 72%;
  border-radius: 50%;
  background:
    radial-gradient(circle at center, #111111 0 11%, transparent 12%),
    radial-gradient(circle at center, #2a2a2a 0 14%, transparent 15%),
    repeating-radial-gradient(circle at center, #0a0a0a 0 1px, #1a1a1a 1px 3px);
  box-shadow:
    inset 0 0 0 1px #00000088,
    0 4px 12px #00000033;
  transition: transform 0.35s ease;
}

.wall-cover {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  background: linear-gradient(145deg, var(--elevated), var(--cabinet));
  overflow: hidden;
  box-shadow:
    0 10px 24px color-mix(in srgb, #000 28%, transparent),
    inset 0 0 0 1px color-mix(in srgb, #fff 5%, transparent);
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
  cursor: pointer;
}

.wall-cover__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wall-cover__empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 2.6rem;
  color: color-mix(in srgb, var(--foil) 70%, transparent);
  background:
    radial-gradient(circle at 30% 20%, var(--glow), transparent 55%),
    linear-gradient(145deg, var(--elevated), var(--cabinet));
}

.wall-cover-actions {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.5rem;
  background: color-mix(in srgb, var(--cabinet) 82%, transparent);
  backdrop-filter: blur(2px);
}

.wall-cover-actions__btn {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  font-size: 0.78rem;
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  min-width: 6.4rem;
  min-height: 2.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background-color 0.2s ease;
}

.wall-cover-actions__btn--play {
  background: var(--foil);
  border-color: var(--foil);
  color: var(--ink);
}

html[data-theme-mode='light'] .wall-cover-actions__btn--play {
  color: var(--card);
}

.wall-cover-actions__btn:hover {
  border-color: var(--foil);
  color: var(--foil);
}

.wall-cover-actions__btn--play:hover {
  background: var(--tungsten);
  border-color: var(--tungsten);
  color: var(--ink);
}

html[data-theme-mode='light'] .wall-cover-actions__btn--play:hover {
  color: var(--card);
}

.wall-card:hover .wall-cover,
.wall-cover:focus-visible,
.wall-cover--selected {
  transform: translateY(-3px) translateX(-2px);
  border-color: var(--foil);
  box-shadow:
    0 16px 34px color-mix(in srgb, #000 40%, transparent),
    inset 0 0 0 1px color-mix(in srgb, #fff 8%, transparent);
}

.wall-card:hover .wall-vinyl,
.wall-card:has(.wall-cover--selected) .wall-vinyl {
  transform: translateX(10px);
}

.wall-card__badge {
  position: absolute;
  right: 0.45rem;
  bottom: 0.45rem;
  z-index: 1;
  background: color-mix(in srgb, var(--cabinet) 88%, transparent);
  border-radius: 4px;
  padding: 2px;
  box-shadow: 0 2px 8px color-mix(in srgb, #000 40%, transparent);
}

.wall-card__meta {
  padding: 0.75rem 0.15rem 0.2rem;
}

.wall-card__name {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.3;
  color: var(--fg);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wall-card__singer,
.wall-card__sub {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wall-empty {
  padding: 3rem 0;
}

@keyframes wall-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 767px) {
  .wall-stats {
    width: 100%;
  }

  .wall-stat {
    flex: 1;
    min-width: 0;
  }

  .wall-search {
    max-width: none;
  }

  .wall-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem 0.7rem;
  }

  .wall-cover-actions {
    gap: 0.35rem;
    padding: 0.4rem;
  }

  .wall-cover-actions__btn {
    min-width: 0;
    width: 100%;
    font-size: 0.72rem;
    padding: 0.35rem 0.4rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wall-card {
    animation: none;
  }

  .wall-vinyl,
  .wall-cover {
    transition: none;
  }
}
</style>
