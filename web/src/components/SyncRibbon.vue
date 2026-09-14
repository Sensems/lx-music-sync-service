<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'

type Running = {
  trackDone: number
  trackTotal: number
  percent: number
  songKey: string | null
  downloaded: number
  byteTotal: number | null
}

const live = ref<{
  title: string
  detail: string
  percent: number
  showBar: boolean
} | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

function formatBytes(n: number): string {
  return `${(n / 1e6).toFixed(1)} MB`
}

function titleForJob(job?: { kind?: string; playlist_id?: number | null } | null): string {
  if (!job) return '同步中'
  if (job.kind === 'all') return '同步中 · 全部歌单'
  if (job.kind === 'search') return '下载中 · 搜索'
  if (job.playlist_id != null) return `同步中 · 歌单 #${job.playlist_id}`
  return '同步中'
}

async function refresh() {
  try {
    const body = await api.jobs()
    const running = body.running as Running | null
    const runJob = (body.list ?? []).find((j: { status: string }) => j.status === 'running')

    if (running && running.trackTotal > 0) {
      const pct = running.percent ?? 0
      const parts = [`${running.trackDone}/${running.trackTotal}`]
      if (running.songKey) {
        const total = running.byteTotal != null ? formatBytes(running.byteTotal) : '?'
        parts.push(`${running.songKey} ${formatBytes(running.downloaded)} / ${total}`)
      }
      live.value = {
        title: titleForJob(runJob),
        detail: parts.join(' · '),
        percent: pct,
        showBar: true,
      }
      return
    }

    if (runJob) {
      live.value = {
        title: titleForJob(runJob),
        detail: `已扫 ${runJob.scanned} · 新下 ${runJob.downloaded}`,
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
      <p v-else class="m-0 text-sm text-mute flex-1">当前没有进行中的任务。可以去歌单同步，或在设置里打开定时。</p>
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
