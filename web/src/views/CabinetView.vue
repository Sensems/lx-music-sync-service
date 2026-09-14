<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Input, InputNumber, Select, Switch, Upload, message } from 'ant-design-vue'
import type { UploadRequestOption } from 'ant-design-vue/es/vc-upload/interface'
import { api } from '../api'

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
  loaded: false,
  name: '',
  version: '',
  status: '还没放脚本，搜得到也压不进去',
})

const saving = ref(false)

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

function applySettings(body: Record<string, unknown>) {
  settings.savePath = String(body.savePath ?? './data/music')
  settings.quality = String(body.quality ?? '320k')
  settings.scheduleOn = body.scheduleOn === '1' || body.scheduleOn === true
  settings.schedule = String(body.schedule ?? 'every-6h')
  settings.cron = String(body.cron ?? '0 */6 * * *')
  settings.concurrency = Number(body.concurrency ?? 3) || 3
  settings.fileName = String(body.fileName ?? 'name-singer')
  settings.proxyOn = body.proxyOn === '1' || body.proxyOn === true
  settings.proxyHost = String(body.proxyHost || '127.0.0.1')
  settings.proxyPort = Number(body.proxyPort || 7890) || 7890

  const ok = body.sourceOk === true || body.sourceOk === '1'
  const name = String(body.name || '')
  const version = String(body.version || '')
  sourceMeta.value = {
    loaded: Boolean(name),
    name,
    version,
    status: ok
      ? `已就绪 · ${name || '源'}`
      : String(body.sourceMessage || '源未就绪'),
  }
}

async function load() {
  try {
    const body = await api.settings()
    applySettings(body)
  } catch {
    message.error('柜门读不到设置')
  }
}

async function save() {
  saving.value = true
  try {
    const body = await api.putSettings({
      savePath: settings.savePath,
      quality: settings.quality,
      scheduleOn: settings.scheduleOn ? '1' : '0',
      schedule: settings.schedule,
      cron: settings.cron,
      concurrency: String(settings.concurrency),
      fileName: settings.fileName,
      proxyOn: settings.proxyOn ? '1' : '0',
      proxyHost: settings.proxyHost,
      proxyPort: String(settings.proxyPort),
    })
    applySettings(body)
    message.success('柜门已关上，设置写下了')
  } catch {
    message.error('写设置失败')
  } finally {
    saving.value = false
  }
}

async function uploadScript(option: UploadRequestOption) {
  const file = option.file as File
  try {
    const status = await api.uploadUserApi(file)
    sourceMeta.value = {
      loaded: true,
      name: String(status.name || file.name.replace(/\.js$/i, '')),
      version: String(status.version || ''),
      status: status.ok ? `已就绪 · ${status.name || ''}` : String(status.message || '源加载失败'),
    }
    message.success('源脚本已放进柜子')
    option.onSuccess?.(status)
  } catch (err) {
    message.error('脚本放不进去')
    option.onError?.(err as Error)
  }
}

onMounted(() => {
  void load()
})
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
        <Upload :show-upload-list="false" accept=".js" :custom-request="uploadScript">
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

      <a-button type="primary" class="stamp !text-ink self-start" :loading="saving" @click="save">写下这些</a-button>
    </div>
  </section>
</template>
