<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import type { JobLine } from '../mock/data'

type JobRow = {
  id: number
  kind: string
  playlist_id: number | null
  status: string
  scanned: number
  skipped: number
  downloaded: number
  failed: number
  error_summary: string | null
  started_at: number
}

type Running = {
  trackDone: number
  trackTotal: number
  percent: number
  songKey: string | null
  downloaded: number
  byteTotal: number | null
} | null

const jobs = ref<JobRow[]>([])
const running = ref<Running>(null)
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

function kindOf(job: JobRow): JobLine['kind'] {
  if (job.status === 'running') return 'run'
  if (job.status === 'skipped') return 'skip'
  if (job.status === 'failed') return 'fail'
  return 'done'
}

function titleOf(job: JobRow): string {
  if (job.status === 'running') {
    if (job.kind === 'all') return '同步中 · 全部启用歌单'
    if (job.kind === 'search') return '下载中 · 搜索'
    return `同步中 · 歌单 #${job.playlist_id ?? '?'}`
  }
  if (job.status === 'skipped') return '已跳过'
  if (job.status === 'failed') return '失败'
  return '已完成'
}

function detailOf(job: JobRow): string {
  if (job.status === 'running' && running.value) {
    const parts = [`${running.value.percent}%`, `${running.value.trackDone}/${running.value.trackTotal}`]
    if (running.value.songKey) {
      const total = running.value.byteTotal != null ? `${(running.value.byteTotal / 1e6).toFixed(1)} MB` : '?'
      parts.push(`${running.value.songKey} ${(running.value.downloaded / 1e6).toFixed(1)} / ${total}`)
    }
    return parts.join(' · ')
  }
  const parts = [
    `扫描 ${job.scanned}`,
    `跳过 ${job.skipped}`,
    `新下载 ${job.downloaded}`,
    `失败 ${job.failed}`,
  ]
  if (job.error_summary) parts.push(job.error_summary)
  return parts.join(' · ')
}

const lines = computed(() => {
  const mapped: JobLine[] = jobs.value.map(j => ({
    id: String(j.id),
    title: titleOf(j),
    detail: detailOf(j),
    kind: kindOf(j),
  }))
  if (running.value && !jobs.value.some(j => j.status === 'running')) {
    mapped.unshift({
      id: 'running',
      title: '同步中',
      detail: detailOf({
        id: 0,
        kind: 'all',
        playlist_id: null,
        status: 'running',
        scanned: 0,
        skipped: 0,
        downloaded: 0,
        failed: 0,
        error_summary: null,
        started_at: Date.now(),
      }),
      kind: 'run',
    })
  }
  return mapped
})

async function refresh() {
  try {
    const body = await api.jobs()
    jobs.value = body.list ?? []
    running.value = body.running ?? null
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
    <p class="text-mute mt-2">查看同步与下载记录：扫过多少、跳过多少、新下了多少。</p>

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
      <p>去歌单同步一张，或在设置里打开定时同步。</p>
      <RouterLink to="/shelf" class="inline-block mt-3 text-foil no-underline hover:underline">去歌单</RouterLink>
    </div>
  </section>
</template>
