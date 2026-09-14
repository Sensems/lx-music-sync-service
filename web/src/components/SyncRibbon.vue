<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'

const live = ref<{ title: string; detail: string } | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

async function refresh() {
  try {
    const body = await api.jobs()
    const running = body.running as { songKey: string; downloaded: number; total: number | null } | null
    if (running) {
      const total = running.total != null ? `${(running.total / 1e6).toFixed(1)} MB` : '?'
      live.value = {
        title: '压盘中',
        detail: `${running.songKey}  ${(running.downloaded / 1e6).toFixed(1)} / ${total}`,
      }
      return
    }
    const runJob = (body.list ?? []).find((j: { status: string }) => j.status === 'running')
    if (runJob) {
      live.value = {
        title: runJob.kind === 'all' ? '压盘中 · 全部' : `压盘中 · #${runJob.playlist_id ?? '?'}`,
        detail: `扫 ${runJob.scanned} · 新压 ${runJob.downloaded}`,
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
  timer = setInterval(() => void refresh(), 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <aside
    class="fixed bottom-0 left-0 right-0 border-0 border-t border-solid border-[#5A3F32] bg-[#1a100e]/95 px-4 md:px-10 py-3 flex flex-wrap items-center gap-4"
    aria-live="polite"
  >
    <span class="flex items-center gap-2 text-tungsten font-mono text-xs tracking-widest">
      <span class="i-lucide-circle-dot text-rec" aria-hidden="true" />
      REC
    </span>
    <p v-if="live" class="m-0 text-sm text-paper flex-1 min-w-50">
      {{ live.title }}
      <span class="text-mute"> · {{ live.detail }}</span>
    </p>
    <p v-else class="m-0 text-sm text-mute flex-1">任务带空着。打开定时，或到歌单墙压一张。</p>
    <RouterLink to="/tape" class="text-foil text-sm no-underline hover:underline cursor-pointer">
      看整条带子
    </RouterLink>
  </aside>
</template>
