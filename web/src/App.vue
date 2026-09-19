<script setup lang="ts">
import { ConfigProvider } from 'ant-design-vue'
import StationBar from './components/StationBar.vue'
import SyncRibbon from './components/SyncRibbon.vue'
import BackToTop from './components/BackToTop.vue'
import PlayerShell from './player/PlayerShell.vue'
import { useTheme } from './composables/useTheme'
import { usePlayer } from './player/usePlayer'
import { computed } from 'vue'

const { antTheme } = useTheme()
const player = usePlayer()
const mainPad = computed(() => (player.current.value ? 'pb-52' : 'pb-28'))
</script>

<template>
  <ConfigProvider :theme="antTheme">
    <div class="min-h-screen flex flex-col bg-cabinet text-fg">
      <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 bg-foil text-ink px-3 py-2">
        跳到内容
      </a>
      <StationBar />
      <main id="main" class="flex-1 px-4 md:px-10" :class="mainPad">
        <router-view v-slot="{ Component, route }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </router-view>
      </main>
      <BackToTop />
      <PlayerShell />
      <SyncRibbon />
    </div>
  </ConfigProvider>
</template>
