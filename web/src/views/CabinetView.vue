<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Input, InputNumber, Select, Switch, Upload, message } from 'ant-design-vue'
import type { UploadChangeParam } from 'ant-design-vue'

const settings = reactive({
  savePath: './data/music',
  quality: '320k',
  scheduleOn: false,
  schedule: 'every-6h',
  cron: '0 */6 * * *',
  concurrency: 3,
  fileName: 'name-singer',
  proxyOn: false,
  proxyHost: '127.0.0.1',
  proxyPort: 7890,
})

const sourceMeta = ref({
  loaded: true,
  name: 'example-source',
  version: '1.2.0',
  status: '已就绪 · kw / kg / tx / wy / mg',
})

const qualityOptions = [
  { value: '128k', label: '128k' },
  { value: '320k', label: '320k' },
  { value: 'flac', label: 'flac' },
  { value: 'flac24bit', label: 'flac24bit' },
]

const scheduleOptions = [
  { value: 'every-6h', label: '每 6 小时' },
  { value: 'daily', label: '每天' },
  { value: 'cron', label: '自定义 cron' },
]

const nameOptions = [
  { value: 'name-singer', label: '歌名 - 歌手' },
  { value: 'singer-name', label: '歌手 - 歌名' },
  { value: 'name', label: '歌名' },
]

function save() {
  message.success('柜门已关上，设置写下了')
}

function onScript({ file }: UploadChangeParam) {
  if (file.status === 'done' || file.originFileObj) {
    sourceMeta.value = {
      loaded: true,
      name: file.name.replace(/\.js$/i, ''),
      version: '本地稿',
      status: '已换上，重启取值后看 inited',
    }
    message.success('源脚本已放进柜子')
  }
}
</script>

<template>
  <section class="max-w-2xl">
    <h2 class="font-display text-4xl m-0">柜门</h2>
    <p class="text-mute mt-2">源脚本和落盘目录在这里换。监听地址仍在配置文件里，免得把自己锁在门外。</p>

    <div class="mt-8 bg-[#2c1c16] border border-solid border-[#5A3F32] p-5 md:p-7 flex flex-col gap-6">
      <div>
        <h3 class="font-display text-2xl m-0">自定义源</h3>
        <p class="text-sm text-mute mt-1 mb-3">
          {{ sourceMeta.loaded ? `${sourceMeta.name} · ${sourceMeta.version}` : '还没放脚本，搜得到也压不进去' }}
        </p>
        <p class="font-mono text-xs text-foil m-0 mb-3">{{ sourceMeta.status }}</p>
        <Upload :show-upload-list="false" accept=".js" :custom-request="({ onSuccess }: any) => onSuccess?.('ok')" @change="onScript">
          <a-button class="stamp">更换 .js</a-button>
        </Upload>
      </div>

      <label class="block">
        <span class="block text-sm text-mute mb-1">下载根目录</span>
        <Input v-model:value="settings.savePath" />
      </label>

      <label class="block">
        <span class="block text-sm text-mute mb-1">默认音质</span>
        <Select v-model:value="settings.quality" :options="qualityOptions" />
      </label>

      <div class="flex items-center justify-between gap-3">
        <span>定时压盘</span>
        <Switch v-model:checked="settings.scheduleOn" />
      </div>
      <label v-if="settings.scheduleOn" class="block">
        <span class="block text-sm text-mute mb-1">间隔</span>
        <Select v-model:value="settings.schedule" :options="scheduleOptions" />
      </label>
      <label v-if="settings.scheduleOn && settings.schedule === 'cron'" class="block">
        <span class="block text-sm text-mute mb-1">cron</span>
        <Input v-model:value="settings.cron" class="font-mono" />
      </label>

      <label class="block">
        <span class="block text-sm text-mute mb-1">同时压几首</span>
        <InputNumber v-model:value="settings.concurrency" :min="1" :max="6" class="w-full" />
      </label>

      <label class="block">
        <span class="block text-sm text-mute mb-1">文件名</span>
        <Select v-model:value="settings.fileName" :options="nameOptions" />
      </label>

      <div class="flex items-center justify-between gap-3">
        <span>网络代理</span>
        <Switch v-model:checked="settings.proxyOn" />
      </div>
      <div v-if="settings.proxyOn" class="grid grid-cols-1 md:grid-cols-[1fr_8rem] gap-3">
        <label>
          <span class="block text-sm text-mute mb-1">主机</span>
          <Input v-model:value="settings.proxyHost" />
        </label>
        <label>
          <span class="block text-sm text-mute mb-1">端口</span>
          <InputNumber v-model:value="settings.proxyPort" :min="1" :max="65535" class="w-full" />
        </label>
      </div>

      <a-button type="primary" class="stamp !text-ink self-start" @click="save">写下这些</a-button>
    </div>
  </section>
</template>
