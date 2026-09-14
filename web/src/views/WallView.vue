<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Drawer, Input, Spin, message } from 'ant-design-vue'
import { api } from '../api'
import SourceIcon from '../components/SourceIcon.vue'
import type { SourceId } from '../mock/data'
import { sourceLabels } from '../mock/data'

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

type LyricPayload = {
  lyric: string
  tlyric?: string
  name?: string
  singer?: string
  picUrl?: string
  error?: string
}

const songs = ref<WallSong[]>([])
const loading = ref(true)
const q = ref('')
const open = ref(false)
const active = ref<WallSong | null>(null)
const lyricLoading = ref(false)
const lyric = ref('')
const tlyric = ref('')
const coverBroken = ref<Record<string, boolean>>({})
const drawerWidth = ref(440)

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return songs.value
  return songs.value.filter(s => {
    const hay = `${s.name} ${s.singer} ${s.source}`.toLowerCase()
    return hay.includes(needle)
  })
})

function markBroken(key: string) {
  coverBroken.value = { ...coverBroken.value, [key]: true }
}

function coverOf(song: WallSong): string {
  if (coverBroken.value[song.song_key] || !song.pic_url) return ''
  return song.pic_url
}

function linesOf(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/^\[\d{1,2}:\d{2}(?:\.\d+)?\]/, '').trim())
    .filter(Boolean)
}

function syncDrawerWidth() {
  drawerWidth.value = Math.min(460, Math.max(300, window.innerWidth - 24))
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

async function openSong(song: WallSong) {
  active.value = song
  open.value = true
  lyric.value = ''
  tlyric.value = ''
  lyricLoading.value = true
  try {
    const body = (await api.lyrics(song.song_key)) as LyricPayload
    if (body.error) throw new Error(body.error)
    lyric.value = body.lyric || ''
    tlyric.value = body.tlyric || ''
  } catch (err) {
    lyric.value = ''
    message.error(err instanceof Error ? err.message : '歌词获取失败')
  } finally {
    lyricLoading.value = false
  }
}

onMounted(() => {
  syncDrawerWidth()
  window.addEventListener('resize', syncDrawerWidth)
  void load()
})

onUnmounted(() => {
  window.removeEventListener('resize', syncDrawerWidth)
})
</script>

<template>
  <section class="wall-page">
    <header class="wall-hero">
      <div>
        <p class="wall-kicker">LIBRARY</p>
        <h2 class="font-display text-4xl md:text-5xl m-0">唱片墙</h2>
        <p class="text-mute mt-2 max-w-xl m-0">
          已下载到本地的歌曲会显示在这里。点封面可以查看在线歌词。
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
      <Input
        v-model:value="q"
        allow-clear
        placeholder="搜歌名 / 歌手 / 平台"
        class="wall-search"
      />
    </div>

    <Spin :spinning="loading">
      <div v-if="filtered.length" class="wall-grid stagger-in">
        <button
          v-for="(song, idx) in filtered"
          :key="song.song_key"
          type="button"
          class="wall-card"
          :style="{ '--i': String(idx % 12) }"
          @click="openSong(song)"
        >
          <div class="wall-sleeve">
            <div class="wall-vinyl" aria-hidden="true" />
            <div class="wall-cover">
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
        </button>
      </div>
      <div v-else-if="!loading" class="wall-empty">
        <p class="font-display text-3xl text-fg m-0">还没有下载的歌曲</p>
        <p class="text-mute">去搜索下载一首，或在歌单里点同步。</p>
      </div>
    </Spin>

    <Drawer
      v-model:open="open"
      placement="right"
      :width="drawerWidth"
      :title="active ? active.name : '歌词'"
      root-class-name="lyric-drawer"
    >
      <div v-if="active" class="lyric-panel">
        <div class="lyric-head">
          <div class="lyric-cover-wrap">
            <img
              v-if="coverOf(active)"
              class="lyric-cover"
              :src="coverOf(active)"
              :alt="active.name"
              @error="markBroken(active.song_key)"
            />
            <div v-else class="lyric-cover lyric-cover--empty">
              {{ (active.name || '?').slice(0, 1) }}
            </div>
          </div>
          <div>
            <p class="lyric-title">{{ active.name }}</p>
            <p class="lyric-artist">{{ active.singer }}</p>
            <p class="lyric-source">
              <SourceIcon :source="active.source" :size="16" />
              <span>{{ sourceLabels[active.source as SourceId] || active.source }}</span>
            </p>
          </div>
        </div>

        <Spin :spinning="lyricLoading">
          <div v-if="lyric" class="lyric-body">
            <p v-for="(line, i) in linesOf(lyric)" :key="'l' + i" class="lyric-line">{{ line }}</p>
            <template v-if="tlyric">
              <hr class="lyric-hr" />
              <p class="lyric-trans-label">译</p>
              <p v-for="(line, i) in linesOf(tlyric)" :key="'t' + i" class="lyric-line lyric-line--trans">{{ line }}</p>
            </template>
          </div>
          <p v-else-if="!lyricLoading" class="text-mute">这首暂时没有歌词。</p>
        </Spin>
      </div>
    </Drawer>
  </section>
</template>

<style scoped>
.wall-page {
  max-width: 1120px;
}

.wall-hero {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  justify-content: space-between;
  align-items: end;
  margin-bottom: 1.5rem;
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
  max-width: 22rem;
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 1.35rem 1rem;
}

.wall-card {
  --i: 0;
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
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

.wall-card:hover .wall-cover,
.wall-card:focus-visible .wall-cover {
  transform: translateY(-3px) translateX(-2px);
  border-color: var(--foil);
  box-shadow:
    0 16px 34px color-mix(in srgb, #000 40%, transparent),
    inset 0 0 0 1px color-mix(in srgb, #fff 8%, transparent);
}

.wall-card:hover .wall-vinyl,
.wall-card:focus-visible .wall-vinyl {
  transform: translateX(10px);
}

.wall-card__badge {
  position: absolute;
  right: 0.45rem;
  bottom: 0.45rem;
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

.lyric-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.lyric-head {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 0.95rem;
  align-items: center;
}

.lyric-cover-wrap {
  width: 96px;
  height: 96px;
}

.lyric-cover {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border: 1px solid var(--border);
  display: block;
  background: linear-gradient(145deg, var(--elevated), var(--cabinet));
}

.lyric-cover--empty {
  display: grid;
  place-items: center;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 2rem;
  color: color-mix(in srgb, var(--foil) 70%, transparent);
}

.lyric-title {
  margin: 0;
  font-size: 1.15rem;
  color: var(--fg);
}

.lyric-artist,
.lyric-source {
  margin: 0.3rem 0 0;
  color: var(--mute);
  font-size: 0.85rem;
}

.lyric-source {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.lyric-body {
  max-height: min(60vh, 560px);
  overflow: auto;
  padding-right: 0.25rem;
}

.lyric-line {
  margin: 0.4rem 0;
  line-height: 1.7;
  color: var(--fg);
}

.lyric-line--trans {
  color: var(--mute);
  font-size: 0.92rem;
}

.lyric-hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 1rem 0 0.75rem;
}

.lyric-trans-label {
  margin: 0 0 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: var(--foil);
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

@media (max-width: 640px) {
  .wall-grid {
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 1rem 0.75rem;
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

<style>
.lyric-drawer .ant-drawer-content {
  background: var(--surface) !important;
  color: var(--fg);
}

.lyric-drawer .ant-drawer-header {
  background: var(--surface) !important;
  border-bottom: 1px solid var(--border) !important;
}

.lyric-drawer .ant-drawer-title,
.lyric-drawer .ant-drawer-close {
  color: var(--fg) !important;
}

.lyric-drawer .ant-drawer-body {
  background: var(--surface);
}
</style>
