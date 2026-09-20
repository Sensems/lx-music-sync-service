<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { Form, Input, Select, Modal, message } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import PlaylistCard from '../components/PlaylistCard.vue'
import { api } from '../api'
import { mapPlaylist } from '../playlists'
import { sourceLabels, type Playlist, type SourceId } from '../mock/data'

const COLS_KEY = 'tingui-shelf-cols'

const router = useRouter()
const list = ref<Playlist[]>([])
const showInsert = ref(false)
const form = reactive({ source: undefined as SourceId | undefined, url: '' })
const loading = ref(true)
const cols = ref<1 | 2>(2)

const sourceOptions = (Object.keys(sourceLabels) as SourceId[]).map(id => ({
  value: id,
  label: sourceLabels[id],
}))

function readCols(): 1 | 2 {
  try {
    return localStorage.getItem(COLS_KEY) === '1' ? 1 : 2
  } catch {
    return 2
  }
}

function setCols(next: 1 | 2) {
  cols.value = next
  try {
    localStorage.setItem(COLS_KEY, String(next))
  } catch {
    /* ignore */
  }
}

async function refresh() {
  loading.value = true
  try {
    const body = await api.playlists()
    list.value = (body.list ?? []).map(mapPlaylist)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载歌单失败')
  } finally {
    loading.value = false
  }
}

async function submitInsert() {
  if (!form.source || !form.url.trim()) {
    message.error('请选择平台并填写链接')
    return
  }
  try {
    const row = await api.addPlaylist({ source: form.source, url: form.url.trim() })
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
    await router.push({ name: 'shelf-detail', params: { id: String(row.id) } })
  } catch {
    message.error('添加失败，请检查平台和链接')
  }
}

onMounted(() => {
  cols.value = readCols()
  void refresh()
})
</script>

<template>
  <section class="shelf page-measure">
    <header class="shelf-head">
      <div>
        <p class="page-kicker">SHELF</p>
        <h2 class="shelf-title">歌单</h2>
        <p class="shelf-lede">点一张看里面的曲目。点「+」再订一份。</p>
      </div>
      <div class="shelf-cols" role="group" aria-label="列表列数">
        <button
          type="button"
          class="shelf-cols__btn"
          :class="cols === 1 ? 'is-on' : ''"
          :aria-pressed="cols === 1"
          @click="setCols(1)"
        >
          <span class="i-lucide-rows-2" aria-hidden="true" />
          单列
        </button>
        <button
          type="button"
          class="shelf-cols__btn"
          :class="cols === 2 ? 'is-on' : ''"
          :aria-pressed="cols === 2"
          @click="setCols(2)"
        >
          <span class="i-lucide-layout-grid" aria-hidden="true" />
          双列
        </button>
      </div>
    </header>

    <div
      class="shelf-grid stagger-in"
      :class="cols === 1 ? 'shelf-grid--1' : 'shelf-grid--2'"
    >
      <PlaylistCard v-for="p in list" :key="p.id" :playlist="p" :cols="cols" />
      <button type="button" class="shelf-add" :class="`shelf-add--${cols}`" @click="showInsert = true">
        <span class="shelf-add__mark" aria-hidden="true">+</span>
        <span class="shelf-add__copy">添加歌单</span>
      </button>
    </div>

    <div v-if="!loading && list.length === 0" class="shelf-empty">
      <p class="font-display text-3xl m-0">还没有歌单</p>
      <p class="text-mute mt-2 mb-0">选择平台，粘贴链接即可。</p>
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
.shelf-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.7rem 1rem;
  margin-bottom: 1.25rem;
}

.shelf-title {
  margin: 0;
  font-family: 'ZCOOL XiaoWei', 'Noto Serif SC', serif;
  font-size: 1.85rem;
  line-height: 1.1;
  font-weight: 400;
}

.shelf-lede {
  margin: 0.4rem 0 0;
  font-size: 0.875rem;
  color: var(--mute);
}

.shelf-cols {
  display: inline-flex;
  border: 1px solid var(--border);
  background: var(--surface);
}

.shelf-cols__btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 2.4rem;
  padding: 0 0.75rem;
  border: 0;
  background: transparent;
  color: var(--mute);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
}

.shelf-cols__btn + .shelf-cols__btn {
  border-left: 1px solid var(--border);
}

.shelf-cols__btn.is-on {
  background: var(--wine);
  color: var(--fg);
}

html[data-theme-mode='light'] .shelf-cols__btn.is-on {
  color: var(--card);
}

.shelf-grid {
  display: grid;
  gap: 1.15rem 0.85rem;
}

.shelf-grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.shelf-grid--1 {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.65rem;
}

.shelf-add {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 0;
  padding: 0.8rem;
  border: 1px dashed var(--border);
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  color: var(--foil);
  cursor: pointer;
  font: inherit;
}

.shelf-add--2 {
  aspect-ratio: 1;
}

.shelf-add--1 {
  min-height: 7.25rem;
}

.shelf-add__mark {
  font-size: 1.8rem;
  font-weight: 300;
  line-height: 1;
}

.shelf-add__copy {
  font-size: 0.85rem;
}

.shelf-add:hover,
.shelf-add:focus-visible {
  border-color: var(--foil);
  background: var(--surface);
}

.shelf-empty {
  margin-top: 2.5rem;
}

@media (min-width: 768px) {
  .shelf-title {
    font-size: 2.5rem;
  }

  .shelf-cols {
    display: none;
  }

  .shelf-grid,
  .shelf-grid--1,
  .shelf-grid--2 {
    grid-template-columns: repeat(auto-fill, minmax(14.25rem, 1fr));
    gap: 1.25rem 1.1rem;
  }

  .shelf-add--1,
  .shelf-add--2 {
    aspect-ratio: 1;
    min-height: 0;
  }
}
</style>
