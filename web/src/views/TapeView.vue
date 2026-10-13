<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import type { JobLine } from '../mock/data'

type JobRow = {
  id: string
  kind: string
  status: string
  payload: Record<string, unknown>
  result: Record<string, unknown>
  error_summary: string | null
}

const jobs = ref<JobRow[]>([])
let timer: ReturnType<typeof setInterval> | undefined

const tone: Record<string, string> = {
  run: 'text-tungsten',
  skip: 'text-mute',
  done: 'text-foil',
  fail: 'text-rec',
}

const mark: Record<string, string> = {
  run: '进行中',
  skip: '跳过',
  done: '完成',
  fail: '失败',
}

const kindTitle: Record<string, string> = {
  'refresh-subscription': '刷新订阅',
  scan: '扫描目录',
  'cache-song': '缓存歌曲',
  'cache-playlist': '缓存歌单',
  recache: '重新缓存',
}

function kindOf(job: JobRow): JobLine['kind'] {
  if (job.status === 'running' || job.status === 'queued') return 'run'
  if (job.status === 'failed') return 'fail'
  return 'done'
}

function titleOf(job: JobRow): string {
  const name = kindTitle[job.kind] ?? job.kind
  const playlistId = job.payload?.playlistId
  const songId = job.payload?.songId
  if (playlistId != null && playlistId !== '') return `${name} · #${playlistId}`
  if (songId != null && songId !== '') return `${name} · #${songId}`
  return name
}

function detailOf(job: JobRow): string {
  if (job.status === 'failed') return job.error_summary || '失败'
  if (job.status === 'queued') return '排队中'
  if (job.status === 'running') return '进行中'
  const result = job.result ?? {}
  if (typeof result.count === 'number') return `写入 ${result.count} 首`
  if (Array.isArray(result.unmerged) || Array.isArray(result.unreadable)) {
    const unmerged = Array.isArray(result.unmerged) ? result.unmerged.length : 0
    const unreadable = Array.isArray(result.unreadable) ? result.unreadable.length : 0
    return `未合并 ${unmerged} · 读不出 ${unreadable}`
  }
  if (typeof result.cached === 'number') {
    return `缓存 ${result.cached} · 跳过 ${Number(result.skipped ?? 0)} · 失败 ${Number(result.failed ?? 0)}`
  }
  if (result.skipped === 'has-file') return '已有文件，跳过'
  if (typeof result.path === 'string') return '已写入缓存'
  return '完成'
}

const lines = computed(() => {
  const mapped: JobLine[] = jobs.value.map(j => ({
    id: String(j.id),
    title: titleOf(j),
    detail: detailOf(j),
    kind: kindOf(j),
  }))
  return mapped
})

async function refresh() {
  try {
    const body = await api.jobs()
    jobs.value = body.list ?? []
  } catch {
    /* keep last */
  }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="max-w-3xl">
    <h2 class="font-display text-4xl m-0">任务</h2>
    <p class="text-mute mt-2">刷新订阅、扫描目录、缓存歌曲，都排在这里。</p>

    <div v-if="lines.length" class="mt-8 relative pl-6 border-0 border-l-2 border-solid border-border stagger-in">
      <article
        v-for="line in lines"
        :key="line.id"
        class="relative mb-8"
      >
        <span class="absolute -left-[1.6rem] top-1 w-3 h-3 rounded-full bg-foil" aria-hidden="true" />
        <p class="font-mono text-xs m-0" :class="tone[line.kind]">{{ mark[line.kind] }}</p>
        <h3 class="text-lg m-0 mt-1 text-fg">{{ line.title }}</h3>
        <p class="text-sm text-mute m-0 mt-1">{{ line.detail }}</p>
      </article>
    </div>
    <div v-else class="mt-10 text-mute">
      <p class="font-display text-2xl text-fg m-0">暂无任务记录</p>
      <p>订阅刷新、扫描或缓存开始后，会出现在这里。</p>
    </div>
  </section>
</template>
