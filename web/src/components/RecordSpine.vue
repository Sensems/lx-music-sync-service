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
    class="record-spine group relative shrink-0 overflow-hidden"
    :class="[
      insert
        ? 'record-spine--insert border border-dashed border-foil text-foil bg-surface/50 hover:bg-surface'
        : 'border border-solid border-border text-fg stamp',
      selected ? 'record-spine--on' : '',
    ]"
    :aria-pressed="selected"
    :aria-label="insert ? '添加歌单' : `打开 ${playlist?.name}`"
    @click="emit('pick')"
  >
    <span
      v-if="!insert && playlist"
      class="spine-face absolute inset-0 flex flex-col items-center"
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
      <SourceIcon :source="playlist.source" :size="12" />
      <span class="spine-name font-display drop-shadow">{{ playlist.name }}</span>
      <span class="spine-count font-mono drop-shadow">{{ playlist.downloaded }}/{{ playlist.trackCount }}</span>
    </span>
    <span v-else class="absolute inset-0 flex items-center justify-center">
      <span class="text-2xl font-light leading-none" aria-hidden="true">+</span>
    </span>
  </button>
</template>

<style scoped>
.record-spine {
  height: var(--spine-h, 8.75rem);
  width: var(--spine-w, 2.6rem);
}

.record-spine--on {
  box-shadow: 0 0 0 2px var(--foil);
  z-index: 1;
}

.spine-face {
  padding: 0.45rem 0.15rem 0.4rem;
  gap: 0.3rem;
  color: #f6ecdc;
  text-shadow: 0 1px 2px #000000aa;
}

.spine-name {
  flex: 1 1 auto;
  min-height: 0;
  max-width: 100%;
  overflow: hidden;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-size: 0.92rem;
  line-height: 1.15;
  letter-spacing: 0.04em;
}

.spine-count {
  font-size: 0.58rem;
  letter-spacing: -0.02em;
  line-height: 1.1;
  opacity: 0.92;
}

.drop-shadow {
  text-shadow: 0 1px 3px #000000cc;
}
</style>
