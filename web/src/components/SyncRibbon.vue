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
  <aside class="sync-ribbon" aria-live="polite">
    <div class="sync-ribbon__row">
      <span class="sync-ribbon__live">
        <span class="i-lucide-activity text-rec" aria-hidden="true" />
        LIVE
      </span>
      <p v-if="live" class="sync-ribbon__copy">
        {{ live.title }}
        <span class="sync-ribbon__detail"> · {{ live.detail }}</span>
        <span v-if="live.showBar" class="sync-ribbon__pct">{{ live.percent }}%</span>
      </p>
      <p v-else class="sync-ribbon__copy sync-ribbon__copy--idle">
        当前没有进行中的任务。可以去歌单同步，或在设置里打开定时。
      </p>
      <RouterLink to="/tape" class="sync-ribbon__link">查看任务</RouterLink>
    </div>
    <div
      v-if="live?.showBar"
      class="sync-ribbon__track"
      role="progressbar"
      :aria-valuenow="live.percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="sync-ribbon__bar" :style="{ width: `${live.percent}%` }" />
    </div>
  </aside>
</template>

<style scoped>
.sync-ribbon {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 32;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.55rem 1rem;
  padding-bottom: calc(0.45rem + var(--safe-b));
  padding-left: max(1rem, var(--safe-l));
  padding-right: max(1rem, var(--safe-r));
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  backdrop-filter: blur(10px);
}

.sync-ribbon__row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.sync-ribbon__live {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  color: var(--tungsten);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
}

.sync-ribbon__copy {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-ribbon__copy--idle {
  color: var(--mute);
}

.sync-ribbon__detail {
  color: var(--mute);
}

.sync-ribbon__pct {
  margin-left: 0.4rem;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  color: var(--foil);
}

.sync-ribbon__link {
  flex-shrink: 0;
  color: var(--foil);
  font-size: 0.85rem;
  text-decoration: none;
}

.sync-ribbon__link:hover {
  text-decoration: underline;
}

.sync-ribbon__track {
  height: 0.35rem;
  width: 100%;
  overflow: hidden;
  background: var(--cabinet);
}

.sync-ribbon__bar {
  height: 100%;
  background: var(--foil);
}

@media (max-width: 767px) {
  .sync-ribbon {
    padding-top: 0.4rem;
    padding-bottom: calc(0.35rem + var(--safe-b));
    gap: 0.25rem;
  }

  .sync-ribbon__copy--idle {
    display: none;
  }

  .sync-ribbon__detail {
    display: none;
  }
}

@media (min-width: 768px) {
  .sync-ribbon {
    padding-left: max(2.5rem, var(--safe-l));
    padding-right: max(2.5rem, var(--safe-r));
  }
}
</style>
