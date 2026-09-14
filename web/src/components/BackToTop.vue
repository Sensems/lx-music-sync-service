<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const visible = ref(false)
const THRESHOLD = 320

function onScroll() {
  visible.value = window.scrollY > THRESHOLD
}

function goTop() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <Transition name="back-top">
    <button
      v-if="visible"
      type="button"
      class="back-top"
      aria-label="回到顶部"
      title="回到顶部"
      @click="goTop"
    >
      <span class="back-top__icon" aria-hidden="true">↑</span>
    </button>
  </Transition>
</template>

<style scoped>
.back-top {
  position: fixed;
  right: 1.25rem;
  bottom: 5.5rem;
  z-index: 40;
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--fg);
  cursor: pointer;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 28%, transparent);
  transition:
    border-color 0.2s ease,
    transform 0.2s ease,
    background-color 0.2s ease;
}

.back-top:hover,
.back-top:focus-visible {
  border-color: var(--foil);
  color: var(--foil);
  transform: translateY(-2px);
}

.back-top__icon {
  font-size: 1.15rem;
  line-height: 1;
  font-weight: 500;
}

.back-top-enter-active,
.back-top-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.back-top-enter-from,
.back-top-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 640px) {
  .back-top {
    right: 1rem;
    bottom: 5.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .back-top,
  .back-top-enter-active,
  .back-top-leave-active {
    transition: none;
  }
}
</style>
