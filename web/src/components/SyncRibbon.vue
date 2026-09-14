<script setup lang="ts">
import { jobLines } from '../mock/data'

const live = jobLines.find(l => l.kind === 'run')
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
