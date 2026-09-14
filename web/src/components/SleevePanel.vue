<script setup lang="ts">
import { Switch } from 'ant-design-vue'
import type { Playlist, Track } from '../mock/data'
import { sourceLabels } from '../mock/data'

const props = defineProps<{
  playlist: Playlist
  tracks: Track[]
  syncing?: boolean
}>()

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  press: []
}>()

function press() {
  emit('press')
}
</script>

<template>
  <article class="bg-paper text-ink p-5 md:p-8 min-h-80 flex flex-col gap-6">
    <header class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      <div>
        <p class="font-mono text-xs tracking-[0.2em] text-[#6b5346] m-0">{{ sourceLabels[playlist.source] }} · SIDE A</p>
        <h2 class="font-display text-4xl m-0 mt-1">{{ playlist.name }}</h2>
        <p class="font-mono text-xs mt-2 break-all text-[#5c4638]">{{ playlist.url }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <Switch :checked="playlist.enabled" @change="(v) => emit('update:enabled', Boolean(v))" />
          <span>{{ playlist.enabled ? '参与定时' : '先搁着' }}</span>
        </label>
        <a-button type="primary" class="stamp !h-11 !px-5 !text-ink" :loading="props.syncing" @click="press">
          压盘
        </a-button>
      </div>
    </header>

    <ol v-if="tracks.length" class="list-none p-0 m-0 flex flex-col gap-1">
      <li
        v-for="(t, i) in tracks"
        :key="t.songKey"
        class="grid grid-cols-[2rem_1fr_auto] gap-3 items-baseline py-2 border-0 border-b border-solid border-[#d8c6a8]"
      >
        <span class="font-mono text-xs text-[#6b5346]">A{{ i + 1 }}</span>
        <span>
          <span class="block text-base">{{ t.name }}</span>
          <span class="text-sm text-[#5c4638]">{{ t.singer }} · {{ t.album }}</span>
        </span>
        <span class="font-mono text-xs">
          <span v-if="t.downloaded" class="text-[#3d4a2a]">在柜</span>
          <span v-else class="text-rec">待压</span>
        </span>
      </li>
    </ol>
    <p v-else class="text-sm text-[#5c4638] m-0">还没有曲目。点「压盘」从线上拉开内页。</p>
  </article>
</template>
