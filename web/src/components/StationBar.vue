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
  <header class="station">
    <div class="station__brand">
      <p class="station__mark">LX Sync</p>
      <h1 class="station__title">听柜</h1>
      <p class="station__lede">把订阅的歌单同步到本地。歌单删了的歌，本地文件还会留着。</p>
    </div>
    <nav aria-label="主导航" class="station__nav">
      <RouterLink
        v-for="s in stations"
        :key="s.to"
        :to="s.to"
        class="station__hit nav-hit"
        active-class="station__hit--on"
      >
        <span class="station__hint">{{ s.hint }}</span>
        <span class="station__label">{{ s.label }}</span>
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.station {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.15rem 1rem 0.7rem;
}

.station__mark {
  margin: 0;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--mute);
}

.station__title {
  margin: 0;
  font-family: 'ZCOOL XiaoWei', 'Noto Serif SC', serif;
  font-size: 2.25rem;
  line-height: 1;
  font-weight: 400;
  color: var(--fg);
}

.station__lede {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: var(--mute);
  max-width: 28rem;
}

.station__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.station__hit {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.3rem 1rem;
  border: 1px solid var(--border);
  color: var(--fg);
  text-decoration: none;
  line-height: 1.15;
}

.station__hit:hover {
  border-color: var(--foil);
}

.station__hint {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--mute);
}

.station__hit--on {
  background: var(--wine);
  border-color: var(--foil);
}

html[data-theme-mode='light'] .station__hit--on {
  color: var(--card);
}

html[data-theme-mode='light'] .station__hit--on .station__hint {
  color: color-mix(in srgb, var(--card) 72%, transparent);
}

@media (max-width: 767px) {
  .station {
    gap: 0.65rem;
    padding: 0.75rem 0 0.45rem;
  }

  .station__brand {
    padding: 0 1rem;
  }

  .station__mark,
  .station__lede {
    display: none;
  }

  .station__title {
    font-size: 1.85rem;
  }

  .station__nav {
    flex-wrap: nowrap;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    gap: 0.4rem;
    padding: 0.1rem 1rem 0.2rem;
    scrollbar-width: none;
  }

  .station__nav::-webkit-scrollbar {
    display: none;
  }

  .station__hit {
    flex: 0 0 auto;
    scroll-snap-align: start;
    min-height: 2.75rem;
    padding: 0.35rem 0.9rem;
  }

  .station__hint {
    display: none;
  }
}

@media (min-width: 768px) {
  .station {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    padding: 1.5rem 2.5rem 1rem;
  }

  .station__title {
    font-size: 3rem;
  }
}
</style>
