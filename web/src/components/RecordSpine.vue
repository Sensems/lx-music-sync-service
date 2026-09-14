<script setup lang="ts">
import type { Playlist } from '../mock/data'
import { sourceLabels } from '../mock/data'

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
    class="stamp group relative h-72 w-14 md:h-80 md:w-16 shrink-0 text-paper"
    :class="insert ? 'border border-dashed border-mute bg-transparent' : ''"
    :aria-pressed="selected"
    :aria-label="insert ? '插一张歌单' : `打开 ${playlist?.name}`"
    @click="emit('pick')"
  >
    <span
      v-if="!insert && playlist"
      class="absolute inset-0 flex flex-col items-center justify-between py-4 px-1"
      :style="{ background: playlist.spine }"
      :class="selected ? 'outline outline-2 outline-foil outline-offset-2' : ''"
    >
      <span class="font-mono text-[10px] tracking-widest opacity-80">{{ sourceLabels[playlist.source] }}</span>
      <span
        class="font-display text-lg writing-vertical-rl [text-orientation:upright] max-h-48 overflow-hidden"
      >{{ playlist.name }}</span>
      <span class="font-mono text-[10px]">{{ playlist.downloaded }}/{{ playlist.trackCount }}</span>
    </span>
    <span v-else class="absolute inset-0 flex items-center justify-center text-mute">
      <span class="i-lucide-plus text-xl" aria-hidden="true" />
    </span>
  </button>
</template>
