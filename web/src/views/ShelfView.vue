<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { Form, Input, Select, Modal, message } from 'ant-design-vue'
import RecordSpine from '../components/RecordSpine.vue'
import SleevePanel from '../components/SleevePanel.vue'
import { playlists as seed, tracksByPlaylist, sourceLabels, type Playlist, type SourceId } from '../mock/data'

const list = ref<Playlist[]>(seed.map(p => ({ ...p })))
const selectedId = ref(list.value[0]?.id ?? '')
const showInsert = ref(false)
const form = reactive({ source: undefined as SourceId | undefined, url: '' })

const selected = computed(() => list.value.find(p => p.id === selectedId.value) ?? list.value[0])
const tracks = computed(() => (selected.value ? tracksByPlaylist[selected.value.id] ?? [] : []))

const sourceOptions = (Object.keys(sourceLabels) as SourceId[]).map(id => ({
  value: id,
  label: sourceLabels[id],
}))

function pick(id: string) {
  selectedId.value = id
}

function setEnabled(value: boolean) {
  if (!selected.value) return
  selected.value.enabled = value
  message.success(value ? '这张会参与定时压盘' : '已搁置，定时不再扫它')
}

function submitInsert() {
  if (!form.source || !form.url.trim()) {
    message.error('平台和链接都要填')
    return
  }
  const id = String(Date.now())
  list.value.push({
    id,
    source: form.source,
    url: form.url.trim(),
    name: '未开封',
    enabled: true,
    trackCount: 0,
    downloaded: 0,
    spine: '#4A1F2A',
  })
  selectedId.value = id
  showInsert.value = false
  form.source = undefined
  form.url = ''
  message.success('已插上。同步后会写上歌单名。')
}
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
          @update:enabled="setEnabled"
        />
        <div v-else class="bg-paper text-ink p-8">
          <p class="font-display text-3xl m-0">柜子还空着</p>
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
