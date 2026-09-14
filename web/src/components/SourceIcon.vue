<script setup lang="ts">
import type { SourceId } from '../mock/data'
import { sourceLabels } from '../mock/data'

const props = withDefaults(
  defineProps<{
    source: SourceId | string
    size?: number
  }>(),
  { size: 18 },
)

const srcMap: Record<string, string> = {
  tx: '/images/tx.png',
  kg: '/images/kg.png',
  kw: '/images/kw.png',
  wy: '/images/wy.png',
  mg: '/images/mg.png',
}

const src = srcMap[props.source] || ''
const label = sourceLabels[props.source as SourceId] || String(props.source)
</script>

<template>
  <img
    v-if="src"
    class="source-icon"
    :src="src"
    :alt="label"
    :title="label"
    :width="size"
    :height="size"
    :style="{ width: size + 'px', height: size + 'px' }"
    loading="lazy"
  />
  <span
    v-else
    class="source-icon source-icon--fallback"
    :title="label"
    :style="{ width: size + 'px', height: size + 'px', lineHeight: size + 'px', fontSize: Math.max(10, size * 0.55) + 'px' }"
  >{{ label.slice(0, 1) }}</span>
</template>

<style scoped>
.source-icon {
  display: inline-block;
  object-fit: contain;
  border-radius: 3px;
  vertical-align: middle;
  flex-shrink: 0;
}
.source-icon--fallback {
  text-align: center;
  background: #5a3f32;
  color: #f2e6d0;
  border-radius: 3px;
}
</style>
