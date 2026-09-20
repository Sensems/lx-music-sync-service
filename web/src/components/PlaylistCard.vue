<script setup lang="ts">
import type { Playlist } from '../mock/data'
import { sourceLabels } from '../mock/data'
import SourceIcon from './SourceIcon.vue'

withDefaults(
  defineProps<{
    playlist: Playlist
    cols?: 1 | 2
  }>(),
  { cols: 2 },
)
</script>

<template>
  <RouterLink
    class="plist-card"
    :class="cols === 1 ? 'plist-card--row' : 'plist-card--stack'"
    :to="{ name: 'shelf-detail', params: { id: playlist.id } }"
    :aria-label="`打开 ${playlist.name}`"
    :style="
      playlist.coverUrl
        ? { backgroundImage: `url(${playlist.coverUrl})` }
        : { background: playlist.spine }
    "
  >
    <span class="plist-card__veil" aria-hidden="true" />
    <span v-if="!playlist.coverUrl" class="plist-card__initial">
      {{ playlist.name.slice(0, 1) }}
    </span>
    <div class="plist-card__meta">
      <p class="plist-card__name">{{ playlist.name }}</p>
      <p class="plist-card__sub">
        <SourceIcon class="plist-card__badge" :source="playlist.source" :size="14" />
        {{ sourceLabels[playlist.source] }}
        <span class="plist-card__count">{{ playlist.downloaded }}/{{ playlist.trackCount }}</span>
      </p>
      <p class="plist-card__sync">{{ playlist.enabled ? '定时同步开着' : '定时已暂停' }}</p>
    </div>
  </RouterLink>
</template>

<style scoped>
.plist-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 0;
  overflow: hidden;
  color: #f6ecdc;
  text-decoration: none;
  background-position: center;
  background-size: cover;
  box-shadow:
    0 12px 28px color-mix(in srgb, #000 32%, transparent),
    inset 0 0 0 1px color-mix(in srgb, #fff 6%, transparent);
  transition: box-shadow 0.28s ease;
}

.plist-card--stack {
  aspect-ratio: 1;
}

.plist-card--row {
  min-height: 7.25rem;
  padding: 0;
}

.plist-card__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    #00000055 0%,
    #00000040 38%,
    #000000b8 78%,
    #000000d4 100%
  );
  pointer-events: none;
}

.plist-card--row .plist-card__veil {
  background: linear-gradient(
    90deg,
    #000000d0 0%,
    #000000a8 42%,
    #00000055 78%,
    #00000033 100%
  );
}

.plist-card__initial {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: 'ZCOOL XiaoWei', 'Noto Serif SC', serif;
  font-size: 3.4rem;
  color: color-mix(in srgb, #f6ecdc 55%, transparent);
  text-shadow: 0 2px 10px #00000066;
  z-index: 0;
  pointer-events: none;
}

.plist-card--row .plist-card__initial {
  justify-content: end;
  padding-right: 1.2rem;
  font-size: 2.4rem;
}

.plist-card__meta {
  position: relative;
  z-index: 1;
  padding: 0.85rem 0.8rem 0.75rem;
  min-width: 0;
}

.plist-card--row .plist-card__meta {
  max-width: 22rem;
  padding: 0.85rem 1rem;
}

.plist-card__name {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.3;
  color: #f6ecdc;
  text-shadow: 0 1px 4px #00000088;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.2s ease;
}

.plist-card__sub,
.plist-card__sync {
  margin: 0.28rem 0 0;
  font-size: 0.78rem;
  color: color-mix(in srgb, #f6ecdc 78%, transparent);
}

.plist-card__sub {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.plist-card__badge {
  flex-shrink: 0;
  border-radius: 2px;
}

.plist-card__count {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  color: var(--foil);
}

.plist-card:hover,
.plist-card:focus-visible {
  box-shadow:
    0 16px 34px color-mix(in srgb, #000 40%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--foil) 55%, transparent);
}

.plist-card:hover .plist-card__name,
.plist-card:focus-visible .plist-card__name {
  color: var(--foil);
}

@media (min-width: 768px) {
  .plist-card--row {
    aspect-ratio: 1;
    min-height: 0;
  }

  .plist-card--row .plist-card__veil {
    background: linear-gradient(
      180deg,
      #00000055 0%,
      #00000040 38%,
      #000000b8 78%,
      #000000d4 100%
    );
  }

  .plist-card--row .plist-card__initial {
    justify-content: center;
    padding-right: 0;
    font-size: 3.4rem;
  }

  .plist-card--row .plist-card__meta {
    max-width: none;
    padding: 0.85rem 0.8rem 0.75rem;
  }
}
</style>
