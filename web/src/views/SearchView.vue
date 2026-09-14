<script setup lang="ts">
import { ref } from 'vue'
import { Input, Select, message } from 'ant-design-vue'
import { searchHits, sourceLabels, type SourceId, type SearchHit } from '../mock/data'

const q = ref('')
const source = ref<SourceId | 'all'>('all')
const hits = ref<SearchHit[]>([])
const searched = ref(false)

const sourceOptions = [
  { value: 'all', label: '全部源' },
  ...(Object.keys(sourceLabels) as SourceId[]).map(id => ({ value: id, label: sourceLabels[id] })),
]

function runSearch() {
  if (!q.value.trim()) {
    message.error('先写下歌名或歌手')
    return
  }
  searched.value = true
  hits.value = searchHits.filter((h) => {
    const text = `${h.name}${h.singer}`.includes(q.value.trim())
    const src = source.value === 'all' || h.source === source.value
    return text && src
  })
}

function press(hit: SearchHit) {
  message.success(`压进 search/：${hit.name}`)
}
</script>

<template>
  <section class="max-w-3xl">
    <h2 class="font-display text-4xl m-0">找一首</h2>
    <p class="text-mute mt-2">搜到的先落地 search 柜格。以后歌单里再出现同一首歌，不会再下。</p>

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
        <a-button type="primary" html-type="submit" class="stamp !h-11 !text-ink w-full md:w-auto">
          查找
        </a-button>
      </div>
    </form>

    <ol v-if="hits.length" class="list-none p-0 mt-8 bg-paper text-ink">
      <li
        v-for="(h, i) in hits"
        :key="h.songKey"
        class="grid grid-cols-[2rem_1fr_auto] gap-3 items-center px-5 py-3 border-0 border-b border-solid border-[#d8c6a8]"
      >
        <span class="font-mono text-xs text-[#6b5346]">{{ String(i + 1).padStart(2, '0') }}</span>
        <span>
          <span class="block">{{ h.name }}</span>
          <span class="text-sm text-[#5c4638]">{{ h.singer }} · {{ sourceLabels[h.source] }}</span>
        </span>
        <a-button type="primary" class="stamp !text-ink" @click="press(h)">压进磁盘</a-button>
      </li>
    </ol>

    <div v-else-if="searched" class="mt-10 text-mute">
      <p class="font-display text-2xl text-paper m-0">没有对上的</p>
      <p>换个关键词，或指定单个平台再找。</p>
    </div>
  </section>
</template>
