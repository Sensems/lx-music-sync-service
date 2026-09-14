<script setup lang="ts">
const stations = [
  { to: '/shelf', label: '歌单墙', hint: '订阅' },
  { to: '/search', label: '找歌', hint: '单曲' },
  { to: '/tape', label: '任务带', hint: '进度' },
  { to: '/cabinet', label: '柜门', hint: '设置' },
]
</script>

<template>
  <header class="px-4 md:px-10 pt-6 pb-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
    <div>
      <p class="font-mono text-xs tracking-[0.28em] text-mute uppercase">LOCAL PRESS</p>
      <h1 class="font-display text-4xl md:text-5xl text-paper m-0 leading-none">听柜</h1>
      <p class="mt-2 text-sm text-mute max-w-md">把订阅的歌单压进本地磁盘。歌单里少了的，柜子里还留着。</p>
    </div>
    <nav aria-label="选台" class="flex flex-wrap gap-2">
      <RouterLink
        v-for="s in stations"
        :key="s.to"
        :to="s.to"
        class="hit-44 px-4 no-underline border border-solid border-[#5A3F32] text-paper hover:border-foil transition-colors duration-200"
        active-class="!bg-wine !border-foil text-paper"
      >
        <span class="flex flex-col items-start leading-tight">
          <span class="text-[10px] font-mono text-mute">{{ s.hint }}</span>
          <span>{{ s.label }}</span>
        </span>
      </RouterLink>
    </nav>
  </header>
</template>
