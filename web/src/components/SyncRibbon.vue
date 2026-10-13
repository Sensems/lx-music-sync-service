<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'

const live = ref<{
  title: string
  detail: string
  percent: number
  showBar: boolean
} | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

const kindTitle: Record<string, string> = {
  'refresh-subscription': '刷新订阅',
  scan: '扫描目录',
  'cache-song': '缓存歌曲',
  'cache-playlist': '缓存歌单',
  recache: '重新缓存',
}

function titleForJob(job?: { kind?: string; payload?: { playlistId?: unknown; songId?: unknown } } | null): string {
  if (!job?.kind) return '进行中'
  const name = kindTitle[job.kind] ?? job.kind
  const playlistId = job.payload?.playlistId
  const songId = job.payload?.songId
  if (playlistId != null && playlistId !== '') return `${name} · #${playlistId}`
  if (songId != null && songId !== '') return `${name} · #${songId}`
  return name
}

async function refresh() {
  try {
    const body = await api.jobs()
    const runJob = (body.list ?? []).find((j: { status: string }) => j.status === 'running' || j.status === 'queued')

    if (runJob) {
      live.value = {
        title: titleForJob(runJob),
        detail: runJob.status === 'queued' ? '排队中' : '进行中',
        percent: 0,
        showBar: false,
      }
      return
    }

    live.value = null
  } catch {
    /* keep */
  }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 1500)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <aside
    class="sync-ribbon fixed bottom-0 left-0 right-0 border-0 border-t border-solid border-border bg-surface/95 px-4 md:px-10 py-3 flex flex-col gap-2"
    aria-live="polite"
  >
    <div class="flex flex-wrap items-center gap-4">
      <span class="flex items-center gap-2 text-tungsten font-mono text-xs tracking-widest">
        <span class="i-lucide-activity text-rec" aria-hidden="true" />
        LIVE
      </span>
      <p v-if="live" class="m-0 text-sm text-fg flex-1 min-w-50">
        {{ live.title }}
        <span class="text-mute"> · {{ live.detail }}</span>
        <span v-if="live.showBar" class="ml-2 font-mono text-foil">{{ live.percent }}%</span>
      </p>
      <p v-else class="m-0 text-sm text-mute flex-1">当前没有进行中的任务。</p>
      <RouterLink to="/tape" class="text-foil text-sm no-underline hover:underline cursor-pointer">
        查看任务
      </RouterLink>
    </div>
    <div
      v-if="live?.showBar"
      class="h-1.5 w-full rounded-sm bg-cabinet overflow-hidden"
      role="progressbar"
      :aria-valuenow="live.percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="sync-ribbon__bar h-full bg-foil" :style="{ width: `${live.percent}%` }" />
    </div>
  </aside>
</template>
