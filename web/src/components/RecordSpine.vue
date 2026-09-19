<script setup lang="ts">
import type { Playlist } from '../mock/data'
import SourceIcon from './SourceIcon.vue'

defineProps<{
  playlist?: Playlist
  selected?: boolean
  insert?: boolean
}>()

const emit = defineEmits<{
  pick: []
}>()
</script>

<template>
  <button
    type="button"
    class="group relative h-52 w-12 sm:h-72 sm:w-14 md:h-80 md:w-16 shrink-0 overflow-hidden"
    :class="
      insert
        ? 'border border-dashed border-foil text-foil bg-surface/50 hover:bg-surface'
        : 'border border-solid border-border text-fg stamp'
    "
    :aria-pressed="selected"
    :aria-label="insert ? '添加歌单' : `打开 ${playlist?.name}`"
    @click="emit('pick')"
  >
    <span
      v-if="!insert && playlist"
      class="absolute inset-0 flex flex-col items-center justify-between py-4 px-1 spine-face"
      :class="selected ? 'outline outline-2 outline-foil outline-offset-2' : ''"
      :style="
        playlist.coverUrl
          ? {
              backgroundImage: `linear-gradient(180deg, #00000099 0%, #00000066 40%, #000000b0 100%), url(${playlist.coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : { background: playlist.spine }
      "
    >
      <SourceIcon :source="playlist.source" :size="14" />
      <span
        class="font-display text-base sm:text-lg writing-vertical-rl [text-orientation:upright] max-h-32 sm:max-h-48 overflow-hidden drop-shadow"
      >{{ playlist.name }}</span>
      <span class="font-mono text-[10px] drop-shadow">{{ playlist.downloaded }}/{{ playlist.trackCount }}</span>
    </span>
    <span v-else class="absolute inset-0 flex items-center justify-center">
      <span class="text-3xl font-light leading-none" aria-hidden="true">+</span>
    </span>
  </button>
</template>

<style scoped>
.spine-face {
  color: #f6ecdc;
  text-shadow: 0 1px 2px #000000aa;
}
.drop-shadow {
  text-shadow: 0 1px 3px #000000cc;
}
</style>
