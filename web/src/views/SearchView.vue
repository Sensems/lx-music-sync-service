<script setup lang="ts">
import { ref } from 'vue'
import { Input, Select, message } from 'ant-design-vue'
import { api } from '../api'
import SourceIcon from '../components/SourceIcon.vue'
import { sourceLabels, type SourceId, type SearchHit } from '../mock/data'

const q = ref('')
const source = ref<SourceId | 'all'>('all')
const hits = ref<SearchHit[]>([])
const searched = ref(false)
const searching = ref(false)
const pressing = ref<string | null>(null)

const sourceOptions = [
  { value: 'all', label: '全部平台' },
  ...(Object.keys(sourceLabels) as SourceId[]).map(id => ({ value: id, label: sourceLabels[id] })),
]

async function runSearch() {
  if (!q.value.trim()) {
    message.error('请输入歌名或歌手')
    return
  }
  searching.value = true
  searched.value = true
  try {
    const body = await api.search(source.value, q.value.trim())
    hits.value = (body.list ?? []).map((m: Record<string, unknown>) => ({
      songKey: String(m.id),
      name: String(m.name ?? ''),
      singer: String(m.singer ?? ''),
      source: m.source as SourceId,
      interval: (m.interval as number | null | undefined) ?? null,
      meta: (m.meta as Record<string, unknown>) ?? {},
    }))
  } catch (err) {
    hits.value = []
    message.error(err instanceof Error ? err.message : '搜索失败')
  } finally {
    searching.value = false
  }
}

async function press(hit: SearchHit) {
  pressing.value = hit.songKey
  try {
    const row = await api.download({
      id: hit.songKey,
      name: hit.name,
      singer: hit.singer,
      source: hit.source,
      interval: hit.interval ?? null,
      meta: hit.meta ?? {},
    })
    if (row.alreadyHad) {
      message.info(`已下载过：${hit.name}`)
    } else {
      message.success(`已下载：${hit.name}`)
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '下载失败')
  } finally {
    pressing.value = null
  }
}
</script>

<template>
  <section class="max-w-3xl">
    <h2 class="font-display text-4xl m-0">搜索</h2>
    <p class="text-mute mt-2">搜索单曲并下载到本地。之后歌单里再出现同一首歌，不会重复下载。</p>

    <form class="mt-6 flex flex-col md:flex-row gap-3" @submit.prevent="runSearch">
      <label class="flex-1">
        <span class="block text-sm text-mute mb-1">关键词</span>
        <Input v-model:value="q" placeholder="歌名，或歌名 歌手" allow-clear />
      </label>
      <label class="md:w-40">
        <span class="block text-sm text-mute mb-1">平台</span>
        <Select v-model:value="source" :options="sourceOptions" />
      </label>
      <div class="flex items-end">
        <a-button type="primary" html-type="submit" class="stamp !h-11 !text-ink w-full md:w-auto" :loading="searching">
          搜索
        </a-button>
      </div>
    </form>

    <ol v-if="hits.length" class="list-none p-0 mt-8 bg-card text-ink stagger-in">
      <li
        v-for="(h, i) in hits"
        :key="h.songKey"
        class="grid grid-cols-[2rem_1fr_auto] gap-3 items-center px-5 py-3 border-0 border-b border-solid border-[#d8c6a8]"
      >
        <span class="font-mono text-xs text-[#6b5346]">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="flex items-start gap-2 min-w-0">
          <SourceIcon class="mt-0.5" :source="h.source" :size="18" />
          <span class="min-w-0">
            <span class="block">{{ h.name }}</span>
            <span class="text-sm text-[#5c4638]">{{ h.singer }} · {{ sourceLabels[h.source] }}</span>
          </span>
        </span>
        <a-button
          type="primary"
          class="stamp !text-ink"
          :loading="pressing === h.songKey"
          @click="press(h)"
        >
          下载到本地
        </a-button>
      </li>
    </ol>

    <div v-else-if="searched" class="mt-10 text-mute">
      <p class="font-display text-2xl text-fg m-0">没有找到结果</p>
      <p>换个关键词，或指定单个平台再试。</p>
    </div>
  </section>
</template>
