<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { useRoute, useRouter } from 'vue-router'
import SleevePanel from '../components/SleevePanel.vue'
import { api, waitJob } from '../api'
import { mapPlaylist, mapTrack } from '../playlists'
import type { Playlist, Track } from '../mock/data'

const route = useRoute()
const router = useRouter()
const playlist = ref<Playlist | null>(null)
const tracks = ref<Track[]>([])
const pendingSyncIds = ref<string[]>([])
const loading = ref(true)
const missing = ref(false)

const playlistId = computed(() => String(route.params.id || ''))

const syncing = computed(() => {
  const id = playlist.value?.id ?? ''
  return id !== '' && pendingSyncIds.value.includes(id)
})

async function loadTracks(id: string) {
  if (!id) {
    tracks.value = []
    return
  }
  try {
    const body = await api.subscriptionTracks(id)
    tracks.value = (body.list ?? []).map((row: Record<string, unknown>) => mapTrack(row))
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
    const body = await api.subscriptions()
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

function pressSync() {
  if (!playlist.value) return
  const playlistId = playlist.value.id
  const name = playlist.value.name
  pendingSyncIds.value = [...pendingSyncIds.value, playlistId]
  void (async () => {
    try {
      const refreshed = await api.refreshSubscription(playlistId)
      const pulled = await waitJob(refreshed.jobId)
      if (!pulled || pulled.status === 'failed') {
        throw new Error(pulled?.error_summary || '拉取曲目失败')
      }
      const queued = await api.cachePlaylist(playlistId)
      const cached = await waitJob(queued.jobId)
      if (!cached || cached.status === 'failed') {
        throw new Error(cached?.error_summary || '缓存失败')
      }
      const result = cached.result ?? {}
      message.success(
        `已更新：${name} · 缓存 ${Number(result.cached ?? 0)} · 跳过 ${Number(result.skipped ?? 0)}`,
      )
      await refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '同步失败')
    } finally {
      const idx = pendingSyncIds.value.indexOf(playlistId)
      if (idx >= 0) {
        pendingSyncIds.value = [
          ...pendingSyncIds.value.slice(0, idx),
          ...pendingSyncIds.value.slice(idx + 1),
        ]
      }
    }
  })()
}

async function removeTrack(songId: string) {
  try {
    await api.removeLibrarySong(songId)
    tracks.value = tracks.value.filter(track => track.songId !== songId)
    message.success('已从曲库去掉')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '去掉这首歌失败')
  }
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
      @press="pressSync"
      @remove="removeTrack"
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
