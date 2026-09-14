<script setup lang="ts">
const stations = [
  { to: '/shelf', label: '歌单', hint: '订阅' },
  { to: '/wall', label: '唱片墙', hint: '已下载' },
  { to: '/search', label: '搜索', hint: '单曲' },
  { to: '/tape', label: '任务', hint: '进度' },
  { to: '/cabinet', label: '设置', hint: '偏好' },
]
</script>

<template>
  <header class="px-4 md:px-10 pt-6 pb-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
    <div>
      <p class="font-mono text-xs tracking-[0.2em] text-mute uppercase">LX Sync</p>
      <h1 class="font-display text-4xl md:text-5xl text-fg m-0 leading-none">听柜</h1>
      <p class="mt-2 text-sm text-mute max-w-md">把订阅的歌单同步到本地。歌单删了的歌，本地文件还会留着。</p>
    </div>
    <nav aria-label="主导航" class="flex flex-wrap gap-2">
      <RouterLink
        v-for="s in stations"
        :key="s.to"
        :to="s.to"
        class="hit-44 px-4 no-underline border border-solid border-border text-fg hover:border-foil nav-hit"
        active-class="!bg-wine !border-foil text-fg"
      >
        <span class="flex flex-col items-start leading-tight">
          <span class="text-[10px] font-mono text-mute">{{ s.hint }}</span>
          <span>{{ s.label }}</span>
        </span>
      </RouterLink>
    </nav>
  </header>
</template>
