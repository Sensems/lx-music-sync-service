<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { useRoute, useRouter } from 'vue-router'
import SleevePanel from '../components/SleevePanel.vue'
import { api } from '../api'
import { mapPlaylist } from '../playlists'
import type { Playlist, Track } from '../mock/data'

const route = useRoute()
const router = useRouter()
const playlist = ref<Playlist | null>(null)
const tracks = ref<Track[]>([])
const pendingSyncIds = ref<number[]>([])
const loading = ref(true)
const missing = ref(false)

const playlistId = computed(() => String(route.params.id || ''))

const syncing = computed(() => {
  const id = playlist.value ? Number(playlist.value.id) : NaN
  return Number.isFinite(id) && pendingSyncIds.value.includes(id)
})

async function loadTracks(id: string) {
  if (!id) {
    tracks.value = []
    return
  }
  try {
    const body = await api.tracks(Number(id))
    tracks.value = (body.list ?? []) as Track[]
  } catch {
    tracks.value = []
  }
}

async function refresh() {
  const id = playlistId.value
  if (!id) {
    missing.value = true
    loading.value = false
    return
  }
  loading.value = true
  missing.value = false
  try {
    const body = await api.playlists()
    const rows = (body.list ?? []) as Record<string, unknown>[]
    const found = rows.map(mapPlaylist).find((p: Playlist) => p.id === id) ?? null
    playlist.value = found
    if (!found) {
      missing.value = true
      tracks.value = []
      return
    }
    await loadTracks(id)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载歌单失败')
  } finally {
    loading.value = false
  }
}

async function setEnabled(value: boolean) {
  if (!playlist.value) return
  try {
    await api.patchPlaylist(Number(playlist.value.id), { enabled: value })
    playlist.value.enabled = value
    message.success(value ? '已加入定时同步' : '已暂停定时同步')
  } catch {
    message.error('更新失败')
  }
}

function pressSync() {
  if (!playlist.value) return
  const id = Number(playlist.value.id)
  const name = playlist.value.name
  pendingSyncIds.value = [...pendingSyncIds.value, id]
  message.success(`已加入同步队列：${name}`)
  void api
    .syncPlaylist(id)
    .then(async job => {
      if (job?.status === 'failed') message.error(`同步失败：${name}`)
      else message.success(`同步完成：${name}`)
      await refresh()
    })
    .catch(err => {
      message.error(err instanceof Error ? err.message : '同步失败')
    })
    .finally(() => {
      const idx = pendingSyncIds.value.indexOf(id)
      if (idx >= 0) {
        pendingSyncIds.value = [
          ...pendingSyncIds.value.slice(0, idx),
          ...pendingSyncIds.value.slice(idx + 1),
        ]
      }
    })
}

watch(playlistId, () => {
  void refresh()
})

onMounted(() => {
  void refresh()
})
</script>

<template>
  <section class="sleeve-page page-measure">
    <button type="button" class="sleeve-back" @click="router.push({ name: 'shelf' })">
      <span class="i-lucide-chevron-left" aria-hidden="true" />
      返回歌单
    </button>

    <SleevePanel
      v-if="playlist"
      :playlist="playlist"
      :tracks="tracks"
      :syncing="syncing"
      @update:enabled="setEnabled"
      @press="pressSync"
    />
    <div v-else class="sleeve-fallback">
      <p class="font-display text-3xl m-0">{{ loading ? '加载中…' : '找不到这张歌单' }}</p>
      <p v-if="missing && !loading" class="mt-2 mb-0">它可能已经被删了，回列表再看一眼。</p>
    </div>
  </section>
</template>

<style scoped>
.sleeve-back {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-height: 2.5rem;
  margin: 0 0 0.85rem;
  padding: 0 0.15rem;
  border: 0;
  background: transparent;
  color: var(--mute);
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
}

.sleeve-back:hover,
.sleeve-back:focus-visible {
  color: var(--foil);
}

.sleeve-fallback {
  min-height: 12rem;
  padding: 1.25rem 1.15rem;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
}

@media (min-width: 768px) {
  .sleeve-fallback {
    padding: 2rem;
  }
}
</style>
