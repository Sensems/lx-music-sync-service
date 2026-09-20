<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const WIDE_KEY = 'tingui-station-wide'
const route = useRoute()

const stations = [
  { to: '/shelf', label: '歌单', icon: 'i-lucide-list-music' },
  { to: '/wall', label: '唱片墙', icon: 'i-lucide-disc-3' },
  { to: '/search', label: '搜索', icon: 'i-lucide-search' },
  { to: '/tape', label: '任务', icon: 'i-lucide-list-checks' },
  { to: '/cabinet', label: '设置', icon: 'i-lucide-settings' },
]

function readWide() {
  try {
    return localStorage.getItem(WIDE_KEY) !== '0'
  } catch {
    return true
  }
}

const wide = ref(readWide())

function persistWide(on: boolean) {
  document.documentElement.classList.toggle('station-slim', !on)
  try {
    localStorage.setItem(WIDE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

watch(wide, persistWide, { immediate: true })

onUnmounted(() => {
  document.documentElement.classList.remove('station-slim')
})

function isOn(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <aside class="station" :class="wide ? 'station--wide' : ''">
    <div class="station__brand">
      <p class="station__mark">LX Sync</p>
      <h1 class="station__title">{{ wide ? '听柜' : '柜' }}</h1>
    </div>
    <nav aria-label="主导航" class="station__nav">
      <RouterLink
        v-for="s in stations"
        :key="s.to"
        :to="s.to"
        class="station__hit"
        :class="isOn(s.to) ? 'station__hit--on' : ''"
        :title="wide ? undefined : s.label"
        :aria-label="wide ? undefined : s.label"
      >
        <span class="station__icon" :class="s.icon" aria-hidden="true" />
        <span class="station__label">{{ s.label }}</span>
      </RouterLink>
    </nav>
    <button
      type="button"
      class="station__fold"
      :aria-expanded="wide"
      :title="wide ? '收起菜单' : '展开菜单'"
      @click="wide = !wide"
    >
      <span
        :class="wide ? 'i-lucide-chevrons-left' : 'i-lucide-chevrons-right'"
        aria-hidden="true"
      />
      <span class="station__fold-label">{{ wide ? '收起' : '展开' }}</span>
    </button>
  </aside>
</template>

<style scoped>
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

.station__icon {
  display: none;
  flex-shrink: 0;
  width: 1.2rem;
  height: 1.2rem;
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
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.station__hit--on {
  background: var(--wine);
  border-color: var(--foil);
}

html[data-theme-mode='light'] .station__hit--on {
  color: var(--card);
}

.station__fold {
  display: none;
}

@media (max-width: 767px) {
  .station {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 32;
    height: var(--station-h);
    padding: 0;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  .station__brand,
  .station__fold {
    display: none;
  }

  .station__nav {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    height: 100%;
    padding: 0.12rem max(0.2rem, var(--safe-l)) var(--safe-b) max(0.2rem, var(--safe-r));
  }

  .station__icon {
    display: block;
  }

  .station__hit {
    align-items: center;
    justify-content: center;
    gap: 0.14rem;
    min-width: 0;
    min-height: 0;
    padding: 0.2rem 0.1rem;
    border: 0;
    background: transparent;
    color: var(--mute);
  }

  .station__hit--on,
  html[data-theme-mode='light'] .station__hit--on {
    background: transparent;
    border-color: transparent;
    color: var(--foil);
    box-shadow: inset 0 2px 0 var(--foil);
  }

  .station__label {
    font-size: 0.68rem;
    line-height: 1;
    white-space: nowrap;
  }
}

@media (min-width: 768px) {
  .station {
    position: fixed;
    top: var(--safe-t);
    left: 0;
    bottom: var(--chrome-bottom);
    z-index: 32;
    display: flex;
    flex-direction: column;
    width: var(--station-w);
    padding: 1.15rem 0.55rem 0.7rem;
    overflow: hidden;
    background: var(--surface);
    border-right: 1px solid var(--border);
    transition: width 0.22s ease;
  }

  .station__brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.2rem 0.85rem;
  }

  .station:not(.station--wide) .station__mark {
    display: none;
  }

  .station__title {
    font-size: 1.65rem;
  }

  .station--wide .station__title {
    font-size: 2rem;
  }

  .station__nav {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 0.4rem;
    min-height: 0;
    overflow: auto;
  }

  .station__icon {
    display: block;
  }

  .station__hit {
    flex-direction: row;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    min-height: 2.85rem;
    padding: 0.35rem 0.55rem;
  }

  .station:not(.station--wide) .station__hit {
    justify-content: center;
    padding: 0.35rem 0;
    border-color: transparent;
    background: transparent;
  }

  .station:not(.station--wide) .station__hit--on,
  html[data-theme-mode='light'] .station:not(.station--wide) .station__hit--on {
    background: transparent;
    color: var(--foil);
    box-shadow: inset 3px 0 0 var(--foil);
  }

  .station__label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .station:not(.station--wide) .station__label,
  .station:not(.station--wide) .station__fold-label {
    display: none;
  }

  .station__hit:hover {
    border-color: var(--foil);
  }

  .station:not(.station--wide) .station__hit:hover {
    color: var(--fg);
  }

  .station__fold {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    width: 100%;
    min-height: 2.5rem;
    margin-top: 0.55rem;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--mute);
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
  }

  .station:not(.station--wide) .station__fold {
    border-color: transparent;
  }

  .station__fold:hover,
  .station__fold:focus-visible {
    border-color: var(--foil);
    color: var(--foil);
  }
}

@media (min-width: 768px) and (prefers-reduced-motion: reduce) {
  .station {
    transition: none;
  }
}
</style>
