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
const syncing = ref(false)
const showInsert = ref(false)
const form = reactive({ source: undefined as SourceId | undefined, url: '' })
const loading = ref(true)

const selected = computed(() => list.value.find(p => p.id === selectedId.value) ?? list.value[0])

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
    name: String(row.name || '未开封'),
    enabled: row.enabled === 1 || row.enabled === true,
    trackCount: Number(row.trackCount ?? 0),
    downloaded: Number(row.downloaded ?? 0),
    spine: spineFor(row.id as number),
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
    message.error(err instanceof Error ? err.message : '歌单墙读不到柜')
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
    message.success(value ? '这张会参与定时压盘' : '已搁置，定时不再扫它')
  } catch {
    message.error('改启用状态失败')
  }
}

async function pressSync() {
  if (!selected.value) return
  syncing.value = true
  try {
    await api.syncPlaylist(Number(selected.value.id))
    message.success(`已开始压盘：${selected.value.name}`)
    await refresh()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '压盘失败')
  } finally {
    syncing.value = false
  }
}

async function submitInsert() {
  if (!form.source || !form.url.trim()) {
    message.error('平台和链接都要填')
    return
  }
  try {
    const row = await api.addPlaylist({ source: form.source, url: form.url.trim() })
    selectedId.value = String(row.id)
    showInsert.value = false
    form.source = undefined
    form.url = ''
    message.success('已插上。同步后会写上歌单名。')
    await refresh()
  } catch {
    message.error('插不进去，检查平台和链接')
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
    <p class="text-mute text-sm mb-4">点一根脊，封套在右边打开。空槽用来插新链接。</p>
    <div class="flex flex-col lg:flex-row gap-6 items-stretch">
      <div
        class="flex gap-3 overflow-x-auto py-2 pr-2"
        role="listbox"
        aria-label="歌单脊"
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
        <div v-else class="bg-paper text-ink p-8">
          <p class="font-display text-3xl m-0">{{ loading ? '正在开柜…' : '柜子还空着' }}</p>
          <p class="mt-2">插一张歌单。要同时选平台、贴上链接。</p>
          <a-button type="primary" class="mt-4 stamp !text-ink" @click="showInsert = true">插一张</a-button>
        </div>
      </div>
    </div>

    <Modal
      v-model:open="showInsert"
      title="插一张歌单"
      ok-text="插上"
      cancel-text="先不"
      :mask-closable="true"
      @ok="submitInsert"
    >
      <Form layout="vertical">
        <Form.Item label="平台" required>
          <Select
            v-model:value="form.source"
            placeholder="必须手选，不按域名猜"
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
