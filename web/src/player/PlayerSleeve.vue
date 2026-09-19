<script setup lang="ts">
defineProps<{
  picUrl: string
  name: string
  playing?: boolean
  /** thumb：底栏方封面；disc：展开页唱片 */
  variant?: 'thumb' | 'disc'
  open?: boolean
}>()
</script>

<template>
  <div
    v-if="(variant ?? 'thumb') === 'thumb'"
    class="player-thumb"
    :class="open ? 'is-open' : ''"
  >
    <img v-if="picUrl" :src="picUrl" :alt="name" />
    <span v-else class="i-lucide-disc-3 player-thumb__empty" aria-hidden="true" />
    <span class="player-thumb__hint" aria-hidden="true">
      <span v-if="open" class="i-lucide-chevron-down" />
      <span v-else class="i-lucide-chevron-up" />
    </span>
  </div>

  <div
    v-else
    class="player-cd"
    :class="playing ? 'is-on' : ''"
  >
    <div class="player-cd__spin">
      <div class="player-cd__vinyl" aria-hidden="true" />
      <div class="player-cd__art">
        <img v-if="picUrl" :src="picUrl" :alt="name" />
        <span v-else class="i-lucide-disc-3 player-cd__empty" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-thumb {
  position: relative;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 0.25rem;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--elevated);
}

.player-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.player-thumb__empty {
  position: absolute;
  inset: 0;
  margin: auto;
  font-size: 1.25rem;
  color: color-mix(in srgb, var(--foil) 70%, var(--mute));
}

.player-thumb__hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--ink) 42%, transparent);
  color: #fff;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.player-thumb:hover .player-thumb__hint,
.player-thumb.is-open .player-thumb__hint {
  opacity: 1;
}

.player-cd {
  width: min(20rem, 42vw);
  aspect-ratio: 1;
  flex-shrink: 0;
  filter: drop-shadow(0 18px 40px color-mix(in srgb, #000 45%, transparent));
}

.player-cd__spin {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  animation: player-cd-spin 24s linear infinite;
  animation-play-state: paused;
}

.player-cd.is-on .player-cd__spin {
  animation-play-state: running;
}

.player-cd__vinyl {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 28%, color-mix(in srgb, #fff 18%, transparent), transparent 26%),
    radial-gradient(circle at center, #2a2a2a 0 11%, transparent 12%),
    repeating-radial-gradient(circle at center, #0c0c0c 0 1px, #1a1a1a 1px 3px);
  box-shadow:
    inset 0 0 0 1px #000000aa,
    0 0 0 1px #00000055;
}

.player-cd__art {
  position: absolute;
  inset: 19%;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, var(--elevated), var(--cabinet));
  box-shadow:
    0 0 0 3px #111,
    0 0 0 4px #3a3a3a;
}

.player-cd__art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.player-cd__empty {
  font-size: 3rem;
  color: color-mix(in srgb, var(--foil) 78%, var(--mute));
}

@keyframes player-cd-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 767px) {
  .player-thumb {
    width: 2.75rem;
    height: 2.75rem;
  }

  .player-cd {
    width: min(14.5rem, 58vw);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-thumb__hint {
    transition: none;
  }

  .player-cd__spin {
    animation: none;
  }
}
</style>
