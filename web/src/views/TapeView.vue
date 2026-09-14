<script setup lang="ts">
import { jobLines } from '../mock/data'

const tone: Record<string, string> = {
  run: 'text-tungsten',
  skip: 'text-mute',
  done: 'text-foil',
  fail: 'text-rec',
}

const mark: Record<string, string> = {
  run: '在压',
  skip: '跳过',
  done: '落下',
  fail: '卡住',
}
</script>

<template>
  <section class="max-w-3xl">
    <h2 class="font-display text-4xl m-0">任务带</h2>
    <p class="text-mute mt-2">这一轮扫了什么、跳过什么、新压了什么。不是一张进度表。</p>

    <div class="mt-8 relative pl-6 border-0 border-l-2 border-solid border-[#5A3F32]">
      <article
        v-for="line in jobLines"
        :key="line.id"
        class="relative mb-8"
      >
        <span class="absolute -left-[1.6rem] top-1 w-3 h-3 rounded-full bg-foil" aria-hidden="true" />
        <p class="font-mono text-xs m-0" :class="tone[line.kind]">{{ mark[line.kind] }}</p>
        <h3 class="text-lg m-0 mt-1 text-paper">{{ line.title }}</h3>
        <p class="text-sm text-mute m-0 mt-1">{{ line.detail }}</p>
      </article>
    </div>
  </section>
</template>
