<script setup lang="ts">
import { ref } from 'vue'
import { Input, Select, message } from 'ant-design-vue'
import { api } from '../api'
import SourceIcon from '../components/SourceIcon.vue'
import { sourceLabels, type SourceId, type SearchHit } from '../mock/data'
import { usePlayer } from '../player/usePlayer'
import type { PlayItem } from '../player/types'

const { playOne, enqueue } = usePlayer()

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

function toItem(h: SearchHit): PlayItem {
  return {
    songKey: h.songKey,
    name: h.name,
    singer: h.singer,
    picUrl: String(h.meta?.picUrl || ''),
    source: h.source,
    musicInfo: {
      id: h.songKey,
      name: h.name,
      singer: h.singer,
      source: h.source,
      interval: h.interval ?? null,
      meta: h.meta ?? {},
    },
  }
}

async function onPlay(hit: SearchHit) {
  await playOne(toItem(hit))
}

function onEnqueue(hit: SearchHit) {
  const { added, started } = enqueue(toItem(hit))
  if (!added) message.info('已经在队列里')
  else if (!started) message.success('已加入队列')
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
    <h2 class="font-display text-3xl md:text-4xl m-0">搜索</h2>
    <p class="text-mute mt-2">搜索单曲并下载到本地。之后歌单里再出现同一首歌，不会重复下载。</p>

    <form class="search-form" @submit.prevent="runSearch">
      <label class="flex-1 min-w-0">
        <span class="block text-sm text-mute mb-1">关键词</span>
        <Input v-model:value="q" placeholder="歌名，或歌名 歌手" allow-clear autocomplete="off" name="q" inputmode="search" />
      </label>
      <label class="search-form__source">
        <span class="block text-sm text-mute mb-1">平台</span>
        <Select v-model:value="source" :options="sourceOptions" />
      </label>
      <div class="search-form__submit">
        <a-button type="primary" html-type="submit" class="stamp !h-11 !text-ink w-full md:w-auto" :loading="searching">
          搜索
        </a-button>
      </div>
    </form>

    <ol v-if="hits.length" class="list-none p-0 mt-8 bg-card text-ink stagger-in">
      <li
        v-for="(h, i) in hits"
        :key="h.songKey"
        class="search-row"
      >
        <span class="search-row__idx">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="search-row__meta min-w-0">
          <SourceIcon class="mt-0.5 shrink-0" :source="h.source" :size="18" />
          <span class="min-w-0">
            <span class="search-row__name">{{ h.name }}</span>
            <span class="search-row__sub">{{ h.singer }} · {{ sourceLabels[h.source] }}</span>
          </span>
        </span>
        <div class="search-row__ops">
          <button type="button" class="search-row-btn" @click="onPlay(h)">
            <span class="i-lucide-play" aria-hidden="true" />
            播放
          </button>
          <button type="button" class="search-row-btn" @click="onEnqueue(h)">
            <span class="i-lucide-list-plus" aria-hidden="true" />
            加入队列
          </button>
          <a-button
            type="primary"
            class="stamp !text-ink !h-11 !px-3 !text-sm !inline-flex !items-center !gap-1 !flex-1 sm:!flex-none sm:!h-auto sm:!px-2 sm:!py-0.5 sm:!text-sm"
            :loading="pressing === h.songKey"
            @click="press(h)"
          >
            <span v-if="pressing !== h.songKey" class="i-lucide-download" aria-hidden="true" />
            下载到本地
          </a-button>
        </div>
      </li>
    </ol>

    <div v-else-if="searched" class="mt-10 text-mute">
      <p class="font-display text-2xl text-fg m-0">没有找到结果</p>
      <p>换个关键词，或指定单个平台再试。</p>
    </div>
  </section>
</template>

<style scoped>
.search-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.search-form__submit {
  display: flex;
  align-items: flex-end;
}

.search-row {
  display: grid;
  grid-template-columns: 2rem 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem 1.25rem;
  border: 0;
  border-bottom: 1px solid #d8c6a8;
}

.search-row__idx {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: #6b5346;
}

.search-row__meta {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.search-row__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-row__sub {
  display: block;
  font-size: 0.875rem;
  color: #5c4638;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-row__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: flex-end;
}

.search-row-btn {
  appearance: none;
  padding: 0.2rem 0.25rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-height: 2.5rem;
}

.search-row-btn:hover {
  color: #3d4a2a;
}

@media (max-width: 767px) {
  .search-row {
    grid-template-columns: 1.6rem 1fr;
    padding: 0.85rem 0.9rem;
  }

  .search-row__ops {
    grid-column: 2;
    justify-content: flex-start;
    width: 100%;
  }
}

@media (min-width: 768px) {
  .search-form {
    flex-direction: row;
    align-items: flex-end;
  }

  .search-form__source {
    width: 10rem;
  }

  .search-row-btn {
    font-size: 0.875rem;
  }
}
</style>
