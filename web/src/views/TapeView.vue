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
  songKey: string
  downloaded: number
  total: number | null
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
  run: '在压',
  skip: '跳过',
  done: '落下',
  fail: '卡住',
}

function kindOf(job: JobRow): JobLine['kind'] {
  if (job.status === 'running') return 'run'
  if (job.status === 'skipped') return 'skip'
  if (job.status === 'failed') return 'fail'
  return 'done'
}

function titleOf(job: JobRow): string {
  if (job.status === 'running') {
    if (job.kind === 'all') return '压盘中 · 全部启用'
    if (job.kind === 'search') return '压盘中 · 找歌'
    return `压盘中 · 歌单 #${job.playlist_id ?? '?'}`
  }
  if (job.status === 'skipped') return '跳过'
  if (job.status === 'failed') return '失败'
  return '完成'
}

function detailOf(job: JobRow): string {
  if (job.status === 'running' && running.value) {
    const total = running.value.total != null ? `${(running.value.total / 1e6).toFixed(1)} MB` : '?'
    return `${running.value.songKey}  ${(running.value.downloaded / 1e6).toFixed(1)} / ${total}`
  }
  const parts = [
    `扫 ${job.scanned}`,
    `跳过 ${job.skipped}`,
    `新压 ${job.downloaded}`,
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
      title: '压盘中',
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
    <h2 class="font-display text-4xl m-0">任务带</h2>
    <p class="text-mute mt-2">这一轮扫了什么、跳过什么、新压了什么。不是一张进度表。</p>

    <div v-if="lines.length" class="mt-8 relative pl-6 border-0 border-l-2 border-solid border-[#5A3F32]">
      <article
        v-for="line in lines"
        :key="line.id"
        class="relative mb-8"
      >
        <span class="absolute -left-[1.6rem] top-1 w-3 h-3 rounded-full bg-foil" aria-hidden="true" />
        <p class="font-mono text-xs m-0" :class="tone[line.kind]">{{ mark[line.kind] }}</p>
        <h3 class="text-lg m-0 mt-1 text-paper">{{ line.title }}</h3>
        <p class="text-sm text-mute m-0 mt-1">{{ line.detail }}</p>
      </article>
    </div>
    <div v-else class="mt-10 text-mute">
      <p class="font-display text-2xl text-paper m-0">带子还空着</p>
      <p>到歌单墙压一张，或打开柜门里的定时。</p>
      <RouterLink to="/shelf" class="inline-block mt-3 text-foil no-underline hover:underline">去插一张</RouterLink>
    </div>
  </section>
</template>
