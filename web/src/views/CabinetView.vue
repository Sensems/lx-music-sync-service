<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Input, Select, Switch, Upload, message } from 'ant-design-vue'
import type { UploadRequestOption } from 'ant-design-vue/es/vc-upload/interface'
import { api } from '../api'
import { sourceLabels } from '../mock/data'
import { useTheme } from '../composables/useTheme'
import { themeList, type ThemeId } from '../themes'

const settings = reactive({
  quality: '128k',
  sourceOrder: 'kw,kg,tx,wy,mg',
  scheduleOn: false,
  schedule: 'every-6h',
  scheduleTime: '03:00',
  cron: '',
  scanWithSchedule: false,
  subsonicUser: 'tinggui',
  subsonicPassword: '',
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

function sourceOrderOk(value: string): boolean {
  const parts = value.split(',').map(part => part.trim()).filter(part => part.length > 0)
  if (parts.length !== 5) return false
  const seen = new Set(parts)
  if (seen.size !== 5) return false
  return parts.every(part => part in sourceLabels)
}

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
  settings.quality = String(body.quality ?? '128k')
  settings.sourceOrder = String(body.sourceOrder ?? 'kw,kg,tx,wy,mg')
  settings.scheduleOn = body.scheduleOn === '1' || body.scheduleOn === true
  settings.schedule = String(body.schedule ?? 'every-6h')
  settings.scheduleTime = String(body.scheduleTime ?? '03:00')
  settings.cron = String(body.cron ?? '')
  settings.scanWithSchedule = body.scanWithSchedule === '1' || body.scanWithSchedule === true
  settings.subsonicUser = String(body.subsonicUser ?? 'tinggui')
  settings.subsonicPassword = ''
  applySourceStatus({
    ok: body.sourceOk,
    name: body.name,
    version: body.version,
    message: body.sourceMessage,
  })
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
  if (!sourceOrderOk(settings.sourceOrder)) {
    message.error('音源顺序要写满五个平台，各一次')
    return
  }
  saving.value = true
  try {
    const payload: Record<string, string> = {
      quality: settings.quality,
      sourceOrder: settings.sourceOrder.split(',').map(part => part.trim()).join(','),
      scheduleOn: settings.scheduleOn ? '1' : '0',
      schedule: settings.schedule,
      scheduleTime: settings.scheduleTime,
      cron: settings.cron,
      scanWithSchedule: settings.scanWithSchedule ? '1' : '0',
      subsonicUser: settings.subsonicUser.trim(),
    }
    if (settings.subsonicPassword.length > 0) payload.subsonicPassword = settings.subsonicPassword
    const body = await api.putSettings(payload)
    applySettings(body)
    message.success('设置已保存')
  } catch (err) {
    const text = err instanceof Error ? err.message : ''
    message.error(text === 'invalid cron' ? '这组定时表达式不能用' : '保存失败')
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
  <section class="page-panel page-measure">
    <p class="page-kicker">CABINET</p>
    <h2 class="font-display text-3xl md:text-4xl m-0">设置</h2>
    <p class="text-mute mt-2">管理音源、音质和定时。服务监听地址仍在配置文件里修改。</p>

    <div class="mt-6 md:mt-8 p-4 sm:p-5 md:p-7 flex flex-col gap-6 cabinet-card">
      <div>
        <h3 class="font-display text-2xl m-0">外观主题</h3>
        <p class="text-sm text-mute mt-1 mb-3">选择一套配色，偏好保存在本机浏览器。</p>
        <div class="theme-grid stagger-in">
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
            <a-button type="primary" class="stamp !h-11 !text-ink">上传 .js</a-button>
          </Upload>
        </div>
        <label class="block">
          <span class="block text-sm text-mute mb-1">在线导入（http/https 直链）</span>
          <div class="flex flex-col sm:flex-row gap-2">
            <Input v-model:value="importUrl" placeholder="https://example.com/source.js" class="flex-1" />
            <a-button type="primary" class="stamp !h-11 !text-ink" :loading="importing" @click="importFromUrl">在线导入</a-button>
          </div>
        </label>
      </div>

      <label class="block">
        <span class="block text-sm text-mute mb-1">默认音质</span>
        <Select v-model:value="settings.quality" :options="qualityOptions" />
      </label>

      <label class="block">
        <span class="block text-sm text-mute mb-1">音源顺序</span>
        <Input v-model:value="settings.sourceOrder" class="font-mono" placeholder="kw,kg,tx,wy,mg" />
        <span class="block text-sm text-mute mt-1">五个平台各写一次。播放和缓存按这个顺序试。{{ Object.values(sourceLabels).join('、') }}。</span>
      </label>

      <div class="flex items-center justify-between gap-3">
        <span>定时刷新订阅</span>
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
      <div v-if="settings.scheduleOn" class="flex items-center justify-between gap-3">
        <span>定时时一并扫描目录</span>
        <Switch v-model:checked="settings.scanWithSchedule" />
      </div>

      <label class="block">
        <span class="block text-sm text-mute mb-1">Subsonic 用户名</span>
        <Input v-model:value="settings.subsonicUser" autocomplete="off" />
      </label>
      <label class="block">
        <span class="block text-sm text-mute mb-1">Subsonic 口令</span>
        <Input v-model:value="settings.subsonicPassword" type="password" autocomplete="new-password" placeholder="留空则不修改" />
      </label>

      <a-button type="primary" class="stamp !text-ink self-stretch sm:self-start !h-11" :loading="saving" @click="save">保存设置</a-button>
    </div>
  </section>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 0.75rem;
}

@media (max-width: 767px) {
  .theme-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }
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
