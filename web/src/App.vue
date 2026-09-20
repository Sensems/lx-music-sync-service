<script setup lang="ts">
import { ConfigProvider } from 'ant-design-vue'
import StationBar from './components/StationBar.vue'
import SyncRibbon from './components/SyncRibbon.vue'
import BackToTop from './components/BackToTop.vue'
import PlayerShell from './player/PlayerShell.vue'
import { useTheme } from './composables/useTheme'
import { usePlayer } from './player/usePlayer'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const { antTheme } = useTheme()
const player = usePlayer()
const route = useRoute()
const router = useRouter()
const isNow = computed(() => route.name === 'now')

watch(
  () => Boolean(player.current.value),
  on => {
    document.documentElement.classList.toggle('has-player', on)
  },
  { immediate: true },
)

watch(
  isNow,
  on => {
    player.expanded.value = on
    document.documentElement.classList.toggle('is-now', on)
    if (on && !player.current.value) {
      void router.replace({ name: 'shelf' })
      return
    }
    if (!on) {
      player.exitCar()
      player.showQueue.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <ConfigProvider :theme="antTheme">
    <div class="app-shell min-h-dvh flex flex-col bg-cabinet text-fg" :class="{ 'app-shell--now': isNow }">
      <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 bg-foil text-ink px-3 py-2">
        跳到内容
      </a>
      <StationBar v-if="!isNow" />
      <main id="main" class="app-main flex-1" :class="{ 'app-main--now': isNow }">
        <router-view v-slot="{ Component, route: viewRoute }">
          <Transition :name="isNow ? 'now-fade' : 'page-fade'" mode="out-in">
            <component :is="Component" :key="viewRoute.path" />
          </Transition>
        </router-view>
      </main>
      <BackToTop />
      <PlayerShell />
      <SyncRibbon v-if="!isNow" />
    </div>
  </ConfigProvider>
</template>

<style scoped>
.app-shell {
  padding-top: var(--safe-t);
  padding-left: var(--safe-l);
  padding-right: var(--safe-r);
}

.app-main {
  padding: 0 1rem calc(var(--chrome-bottom) + 1rem);
}

.app-main--now {
  padding: 0;
}

@media (min-width: 768px) {
  .app-main {
    padding-left: 2.5rem;
    padding-right: 2.5rem;
    padding-bottom: calc(var(--chrome-bottom) + 1.25rem);
  }

  .app-main--now {
    padding: 0;
  }
}
</style>
