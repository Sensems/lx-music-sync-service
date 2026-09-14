<script setup lang="ts">
import { ConfigProvider } from 'ant-design-vue'
import StationBar from './components/StationBar.vue'
import SyncRibbon from './components/SyncRibbon.vue'
import { cabinetTheme } from './theme'
</script>

<template>
  <ConfigProvider :theme="cabinetTheme">
    <div class="min-h-screen flex flex-col">
      <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 bg-foil text-ink px-3 py-2">
        跳到内容
      </a>
      <StationBar />
      <main id="main" class="flex-1 px-4 md:px-10 pb-28">
        <router-view />
      </main>
      <SyncRibbon />
    </div>
  </ConfigProvider>
</template>
