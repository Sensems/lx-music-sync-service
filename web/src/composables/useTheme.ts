import { computed, ref, watch } from 'vue'
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  applyThemeTokens,
  buildAntTheme,
  isThemeId,
  themes,
  themeList,
  type ThemeId,
} from '../themes'

const themeId = ref<ThemeId>(readStoredTheme())
let started = false

function readStoredTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeId(raw)) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_ID
}

function ensureWatcher() {
  if (started) return
  started = true
  watch(
    themeId,
    id => {
      const appTheme = themes[id]
      applyThemeTokens(appTheme.tokens)
      document.documentElement.dataset.theme = id
      document.documentElement.dataset.themeMode = appTheme.mode
      try {
        localStorage.setItem(THEME_STORAGE_KEY, id)
      } catch {
        /* ignore */
      }
    },
    { immediate: true },
  )
}

export function useTheme() {
  ensureWatcher()
  const current = computed(() => themes[themeId.value])
  const antTheme = computed(() => buildAntTheme(current.value))

  function setTheme(id: ThemeId) {
    themeId.value = id
  }

  return {
    themeId,
    current,
    antTheme,
    setTheme,
    themes,
    themeList,
  }
}
