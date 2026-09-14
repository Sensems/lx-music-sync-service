<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Input, InputNumber, Select, Switch, Upload, message } from 'ant-design-vue'
import type { UploadRequestOption } from 'ant-design-vue/es/vc-upload/interface'
import { api } from '../api'
import { useTheme } from '../composables/useTheme'
import { themeList, type ThemeId } from '../themes'

const settings = reactive({
  savePath: './data/music',
  quality: '320k',
  scheduleOn: false,
  schedule: 'every-6h',
  scheduleTime: '03:00',
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
  status: '尚未导入音源脚本，搜索和下载会不可用',
})

const importUrl = ref('')
const importing = ref(false)
const saving = ref(false)

const { themeId, setTheme } = useTheme()

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

function applySourceStatus(status: Record<string, unknown>, fallbackName = '') {
  const ok = status.ok === true || status.ok === '1'
  const name = String(status.name || fallbackName || '')
  const version = String(status.version || '')
  sourceMeta.value = {
    loaded: Boolean(name) || ok,
    name,
    version,
    status: ok ? `已就绪 · ${name || '音源'}` : String(status.message || status.error || '音源未就绪'),
  }
}

function applySettings(body: Record<string, unknown>) {
  settings.savePath = String(body.savePath ?? './data/music')
  settings.quality = String(body.quality ?? '320k')
  settings.scheduleOn = body.scheduleOn === '1' || body.scheduleOn === true
  settings.schedule = String(body.schedule ?? 'every-6h')
  settings.scheduleTime = String(body.scheduleTime ?? '03:00')
  settings.cron = String(body.cron ?? '0 */6 * * *')
  settings.concurrency = Number(body.concurrency ?? 3) || 3
  settings.fileName = String(body.fileName ?? 'name-singer')
  settings.proxyOn = body.proxyOn === '1' || body.proxyOn === true
  settings.proxyHost = String(body.proxyHost || '127.0.0.1')
  settings.proxyPort = Number(body.proxyPort || 7890) || 7890
  applySourceStatus(body)
}

async function load() {
  try {
    const body = await api.settings()
    applySettings(body)
  } catch {
    message.error('加载设置失败')
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
      scheduleTime: settings.scheduleTime,
      cron: settings.cron,
      concurrency: String(settings.concurrency),
      fileName: settings.fileName,
      proxyOn: settings.proxyOn ? '1' : '0',
      proxyHost: settings.proxyHost,
      proxyPort: String(settings.proxyPort),
    })
    applySettings(body)
    message.success('设置已保存')
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function uploadScript(option: UploadRequestOption) {
  const file = option.file as File
  try {
    const status = await api.uploadUserApi(file)
    applySourceStatus(status, file.name.replace(/\.js$/i, ''))
    message.success('音源脚本已更新')
    option.onSuccess?.(status)
  } catch (err) {
    message.error('上传失败')
    option.onError?.(err as Error)
  }
}

async function importFromUrl() {
  const url = importUrl.value.trim()
  if (!url) {
    message.error('请粘贴脚本直链')
    return
  }
  importing.value = true
  try {
    const status = await api.importUserApiUrl(url)
    applySourceStatus(status)
    if (status.ok) message.success('在线音源已导入')
    else message.warning(String(status.message || '已写入，但尚未完全就绪'))
  } catch (err) {
    message.error(err instanceof Error ? err.message : '在线导入失败')
  } finally {
    importing.value = false
  }
}

function pickTheme(id: ThemeId) {
  setTheme(id)
  message.success(`已切换为「${themeList.find(t => t.id === id)?.label}」`)
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="page-panel max-w-2xl">
    <h2 class="font-display text-4xl m-0">设置</h2>
    <p class="text-mute mt-2">管理音源、下载目录和外观。服务监听地址仍在配置文件里修改。</p>

    <div class="mt-8 p-5 md:p-7 flex flex-col gap-6 cabinet-card">
      <div>
        <h3 class="font-display text-2xl m-0">外观主题</h3>
        <p class="text-sm text-mute mt-1 mb-3">选择一套配色，偏好保存在本机浏览器。</p>
        <div class="theme-grid">
          <button
            v-for="t in themeList"
            :key="t.id"
            type="button"
            class="theme-swatch"
            :class="{ 'theme-swatch--active': themeId === t.id }"
            :aria-pressed="themeId === t.id"
            @click="pickTheme(t.id)"
          >
            <span
              class="theme-swatch__preview"
              :style="{
                background: `linear-gradient(135deg, ${t.tokens.cabinet} 45%, ${t.tokens.surface} 45% 70%, ${t.tokens.foil} 70%)`,
              }"
            />
            <span class="theme-swatch__meta">
              <strong>{{ t.label }}</strong>
              <small>{{ t.hint }}</small>
            </span>
          </button>
        </div>
      </div>

      <div>
        <h3 class="font-display text-2xl m-0">自定义音源</h3>
        <p class="text-sm text-mute mt-1 mb-3">
          {{ sourceMeta.loaded ? `${sourceMeta.name} · ${sourceMeta.version}` : '尚未导入音源脚本，搜索和下载会不可用' }}
        </p>
        <p class="font-mono text-xs text-foil m-0 mb-3">{{ sourceMeta.status }}</p>
        <div class="flex flex-wrap gap-2 mb-3">
          <Upload :show-upload-list="false" accept=".js" :custom-request="uploadScript">
            <a-button class="stamp">上传 .js</a-button>
          </Upload>
        </div>
        <label class="block">
          <span class="block text-sm text-mute mb-1">在线导入（http/https 直链）</span>
          <div class="flex flex-col sm:flex-row gap-2">
            <Input v-model:value="importUrl" placeholder="https://example.com/source.js" class="flex-1" />
            <a-button class="stamp" :loading="importing" @click="importFromUrl">在线导入</a-button>
          </div>
        </label>
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
        <span>定时同步</span>
        <Switch v-model:checked="settings.scheduleOn" />
      </div>
      <label v-if="settings.scheduleOn" class="block">
        <span class="block text-sm text-mute mb-1">间隔</span>
        <Select v-model:value="settings.schedule" :options="scheduleOptions" />
      </label>
      <label v-if="settings.scheduleOn && settings.schedule === 'daily'" class="block">
        <span class="block text-sm text-mute mb-1">每天几点</span>
        <input
          v-model="settings.scheduleTime"
          type="time"
          class="schedule-time w-full px-3 py-2"
        />
      </label>
      <label v-if="settings.scheduleOn && settings.schedule === 'cron'" class="block">
        <span class="block text-sm text-mute mb-1">cron</span>
        <Input v-model:value="settings.cron" class="font-mono" />
      </label>

      <label class="block">
        <span class="block text-sm text-mute mb-1">同时下载数</span>
        <InputNumber v-model:value="settings.concurrency" :min="1" :max="6" class="w-full" />
      </label>

      <label class="block">
        <span class="block text-sm text-mute mb-1">文件名格式</span>
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

      <a-button type="primary" class="stamp !text-ink self-start" :loading="saving" @click="save">保存设置</a-button>
    </div>
  </section>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
}

.theme-swatch {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.55rem;
  border: 1px solid var(--border);
  background: var(--elevated);
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.2s ease,
    transform 0.15s ease;
}

.theme-swatch:hover,
.theme-swatch:focus-visible {
  border-color: var(--foil);
  transform: translateY(-1px);
}

.theme-swatch--active {
  border-color: var(--foil);
  box-shadow: inset 0 0 0 1px var(--foil);
}

.theme-swatch__preview {
  display: block;
  height: 44px;
  border: 1px solid var(--border);
}

.theme-swatch__meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.theme-swatch__meta strong {
  font-weight: 600;
  font-size: 0.95rem;
}

.theme-swatch__meta small {
  color: var(--mute);
  font-size: 0.75rem;
}
</style>
