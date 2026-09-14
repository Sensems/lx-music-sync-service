import { theme } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'
import { DEFAULT_THEME_ID, buildAntTheme, themes } from './themes'

/** @deprecated use useTheme().antTheme — kept for any stray imports */
export const cabinetTheme: ThemeConfig = buildAntTheme(themes[DEFAULT_THEME_ID])

export { theme }
