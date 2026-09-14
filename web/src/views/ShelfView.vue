<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted } from 'vue'
import { Form, Input, Select, Modal, message } from 'ant-design-vue'
import RecordSpine from '../components/RecordSpine.vue'
import SleevePanel from '../components/SleevePanel.vue'
import { api } from '../api'
import { sourceLabels, type Playlist, type SourceId, type Track } from '../mock/data'

const SPINES = ['#6B2D3C', '#3D4A2A', '#2A3A4A', '#5A3D1E', '#4A1F2A', '#3A2A4A']

const list = ref<Playlist[]>([])
const selectedId = ref('')
const tracks = ref<Track[]>([])
const pendingSyncIds = ref<number[]>([])
const showInsert = ref(false)
const form = reactive({ source: undefined as SourceId | undefined, url: '' })
const loading = ref(true)

const selected = computed(() => list.value.find(p => p.id === selectedId.value) ?? list.value[0])
const syncing = computed(() => {
  const id = selected.value ? Number(selected.value.id) : NaN
  return Number.isFinite(id) && pendingSyncIds.value.includes(id)
})

const sourceOptions = (Object.keys(sourceLabels) as SourceId[]).map(id => ({
  value: id,
  label: sourceLabels[id],
}))

function spineFor(id: string | number): string {
  const n = typeof id === 'number' ? id : Number(id) || 0
  return SPINES[Math.abs(n) % SPINES.length]
}

function mapPlaylist(row: Record<string, unknown>): Playlist {
  const id = String(row.id)
  return {
    id,
    source: row.source as SourceId,
    url: String(row.url ?? ''),
    name: String(row.name || '未命名歌单'),
    enabled: row.enabled === 1 || row.enabled === true,
    trackCount: Number(row.trackCount ?? 0),
    downloaded: Number(row.downloaded ?? 0),
    spine: spineFor(row.id as number),
    coverUrl: String(row.coverUrl || '') || undefined,
  }
}

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
  loading.value = true
  try {
    const body = await api.playlists()
    list.value = (body.list ?? []).map(mapPlaylist)
    if (!list.value.find(p => p.id === selectedId.value)) {
      selectedId.value = list.value[0]?.id ?? ''
    }
    await loadTracks(selectedId.value)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载歌单失败')
  } finally {
    loading.value = false
  }
}

function pick(id: string) {
  selectedId.value = id
}

async function setEnabled(value: boolean) {
  if (!selected.value) return
  try {
    await api.patchPlaylist(Number(selected.value.id), { enabled: value })
    selected.value.enabled = value
    message.success(value ? '已加入定时同步' : '已暂停定时同步')
  } catch {
    message.error('更新失败')
  }
}

function pressSync() {
  if (!selected.value) return
  const id = Number(selected.value.id)
  const name = selected.value.name
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

async function submitInsert() {
  if (!form.source || !form.url.trim()) {
    message.error('请选择平台并填写链接')
    return
  }
  try {
    const row = await api.addPlaylist({ source: form.source, url: form.url.trim() })
    selectedId.value = String(row.id)
    showInsert.value = false
    form.source = undefined
    form.url = ''
    message.loading({ content: '正在拉取曲目列表…', key: 'refresh-plist', duration: 0 })
    try {
      await api.refreshPlaylist(Number(row.id))
      message.success({ content: '歌单已添加，曲目列表已更新（尚未下载）', key: 'refresh-plist' })
    } catch (err) {
      message.warning({
        content: err instanceof Error ? err.message : '歌单已添加，但拉取曲目失败',
        key: 'refresh-plist',
      })
    }
    await refresh()
  } catch {
    message.error('添加失败，请检查平台和链接')
  }
}

watch(selectedId, id => {
  void loadTracks(id)
})

onMounted(() => {
  void refresh()
})
</script>

<template>
  <section>
    <p class="text-mute text-sm mb-4">选择左侧歌单查看曲目；点「+」添加新歌单。</p>
    <div class="flex flex-col lg:flex-row gap-6 items-stretch">
      <div
        class="shelf-spines flex gap-3 overflow-x-auto py-2 pr-2 stagger-in"
        role="listbox"
        aria-label="歌单列表"
      >
        <RecordSpine
          v-for="p in list"
          :key="p.id"
          :playlist="p"
          :selected="p.id === selected?.id"
          @pick="pick(p.id)"
        />
        <RecordSpine insert @pick="showInsert = true" />
      </div>
      <div class="flex-1 min-w-0">
        <SleevePanel
          v-if="selected"
          :playlist="selected"
          :tracks="tracks"
          :syncing="syncing"
          @update:enabled="setEnabled"
          @press="pressSync"
        />
        <div v-else class="bg-card text-ink p-8">
          <p class="font-display text-3xl m-0">{{ loading ? '加载中…' : '还没有歌单' }}</p>
          <p class="mt-2">添加一张歌单：选择平台，粘贴链接即可。</p>
          <a-button type="primary" class="mt-4 stamp !text-ink" @click="showInsert = true">添加歌单</a-button>
        </div>
      </div>
    </div>

    <Modal
      v-model:open="showInsert"
      title="添加歌单"
      ok-text="添加"
      cancel-text="取消"
      :mask-closable="true"
      @ok="submitInsert"
    >
      <Form layout="vertical">
        <Form.Item label="平台" required>
          <Select
            v-model:value="form.source"
            placeholder="请选择平台"
            :options="sourceOptions"
          />
        </Form.Item>
        <Form.Item label="链接或歌单 ID" required>
          <Input v-model:value="form.url" placeholder="粘贴分享链接，或只填 ID" />
        </Form.Item>
      </Form>
    </Modal>
  </section>
</template>

<style scoped>
.shelf-spines {
  /* Mobile: full-width horizontal strip */
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex-shrink: 0;
  scrollbar-gutter: stable;
}

@media (min-width: 1024px) {
  .shelf-spines {
    /* Desktop: cap width so track panel always keeps room */
    width: min(22rem, 38vw);
    max-width: 38vw;
    flex: 0 0 auto;
  }
}
</style>
