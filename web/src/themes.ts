import { theme } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

export type ThemeId =
  | 'nightwood'
  | 'paper'
  | 'mist'
  | 'linen'
  | 'dawn'
  | 'slate'
  | 'pine'
  | 'rosewood'
  | 'ink'
  | 'celadon'
  | 'lane'
  | 'moon'

export type ThemeTokens = {
  cabinet: string
  wine: string
  foil: string
  tungsten: string
  rec: string
  fg: string
  card: string
  ink: string
  mute: string
  surface: string
  border: string
  elevated: string
  glow: string
}

export type AppTheme = {
  id: ThemeId
  label: string
  hint: string
  mode: 'dark' | 'light'
  tokens: ThemeTokens
}

export const THEME_STORAGE_KEY = 'tingui-theme'
export const DEFAULT_THEME_ID: ThemeId = 'nightwood'

export const themes: Record<ThemeId, AppTheme> = {
  nightwood: {
    id: 'nightwood',
    label: '夜木',
    hint: '默认 · 暖暗',
    mode: 'dark',
    tokens: {
      cabinet: '#322824',
      wine: '#5c2a36',
      foil: '#d8ae7e',
      tungsten: '#e8b84a',
      rec: '#d14a32',
      fg: '#f6ecdc',
      card: '#f4ead8',
      ink: '#1c120c',
      mute: '#a08b7a',
      surface: '#40332c',
      border: '#6e5648',
      elevated: '#4a3b33',
      glow: '#5c2a3633',
    },
  },
  paper: {
    id: 'paper',
    label: '纸白',
    hint: '浅色 · 白天',
    mode: 'light',
    tokens: {
      cabinet: '#efe9df',
      wine: '#8a3d4c',
      foil: '#9a6a3c',
      tungsten: '#b07d18',
      rec: '#c23b22',
      fg: '#2a211c',
      card: '#fffcf6',
      ink: '#1c120c',
      mute: '#7a6a5c',
      surface: '#ffffff',
      border: '#d2c4b2',
      elevated: '#f7f1e7',
      glow: '#9a6a3c22',
    },
  },
  mist: {
    id: 'mist',
    label: '雾蓝',
    hint: '浅色 · 冷调',
    mode: 'light',
    tokens: {
      cabinet: '#e8eef4',
      wine: '#4a6d8c',
      foil: '#3f6f8f',
      tungsten: '#b08a2e',
      rec: '#c23b22',
      fg: '#1c2733',
      card: '#f7fafc',
      ink: '#152029',
      mute: '#6a7d8f',
      surface: '#ffffff',
      border: '#c5d2de',
      elevated: '#f0f5f9',
      glow: '#3f6f8f22',
    },
  },
  linen: {
    id: 'linen',
    label: '亚麻',
    hint: '浅色 · 柔和',
    mode: 'light',
    tokens: {
      cabinet: '#f2ebe1',
      wine: '#7a5c48',
      foil: '#8b6f4e',
      tungsten: '#a8842a',
      rec: '#c23b22',
      fg: '#2c241c',
      card: '#fffdf9',
      ink: '#1c1510',
      mute: '#7d6e5f',
      surface: '#ffffff',
      border: '#d8cbb8',
      elevated: '#f8f2e9',
      glow: '#8b6f4e22',
    },
  },
  dawn: {
    id: 'dawn',
    label: '晨雾',
    hint: '浅色 · 粉灰',
    mode: 'light',
    tokens: {
      cabinet: '#f3e9ea',
      wine: '#8a5560',
      foil: '#9a6270',
      tungsten: '#b08a3a',
      rec: '#c23b22',
      fg: '#2a1f22',
      card: '#fffafb',
      ink: '#1c1214',
      mute: '#857078',
      surface: '#ffffff',
      border: '#dbc8cd',
      elevated: '#f8eef0',
      glow: '#9a627022',
    },
  },
  slate: {
    id: 'slate',
    label: '青石',
    hint: '冷灰蓝',
    mode: 'dark',
    tokens: {
      cabinet: '#1e2630',
      wine: '#3d5a73',
      foil: '#8eb4c9',
      tungsten: '#d4b56a',
      rec: '#d14a32',
      fg: '#e8eef3',
      card: '#eef2f5',
      ink: '#152029',
      mute: '#8a9aab',
      surface: '#2a3440',
      border: '#4a5a6a',
      elevated: '#343f4c',
      glow: '#3d5a7333',
    },
  },
  pine: {
    id: 'pine',
    label: '松绿',
    hint: '唱片店感',
    mode: 'dark',
    tokens: {
      cabinet: '#1c2822',
      wine: '#3d5c48',
      foil: '#c9b07a',
      tungsten: '#e0c57a',
      rec: '#d14a32',
      fg: '#e9f0e8',
      card: '#eef3ea',
      ink: '#142018',
      mute: '#8a9c8e',
      surface: '#283830',
      border: '#4a6354',
      elevated: '#31463b',
      glow: '#3d5c4833',
    },
  },
  // 比夜木更深、更红：柜门生漆，箔用闷铜，避开陶土橙
  rosewood: {
    id: 'rosewood',
    label: '紫檀',
    hint: '深漆 · 夜里',
    mode: 'dark',
    tokens: {
      cabinet: '#261411',
      wine: '#7a2033',
      foil: '#b89258',
      tungsten: '#d4a04a',
      rec: '#d14a32',
      fg: '#f4e4d4',
      card: '#f3e4d2',
      ink: '#160e0c',
      mute: '#9a756c',
      surface: '#3a201c',
      border: '#6a3e36',
      elevated: '#452824',
      glow: '#7a203333',
    },
  },
  // 墨锭蓝黑，箔是宣纸色而不是金属金，避开黑底荧光绿
  ink: {
    id: 'ink',
    label: '墨',
    hint: '夜读',
    mode: 'dark',
    tokens: {
      cabinet: '#15171e',
      wine: '#3c3650',
      foil: '#c6b494',
      tungsten: '#c4aa58',
      rec: '#d14a32',
      fg: '#e6e3d8',
      card: '#ebe6da',
      ink: '#121218',
      mute: '#8a8894',
      surface: '#222530',
      border: '#454756',
      elevated: '#2c3040',
      glow: '#3c365033',
    },
  },
  // 龙泉窑灰绿，故意做旧，不要薄荷绿
  celadon: {
    id: 'celadon',
    label: '青瓷',
    hint: '浅色 · 釉面',
    mode: 'light',
    tokens: {
      cabinet: '#d2dcd3',
      wine: '#3c5246',
      foil: '#3f5f4c',
      tungsten: '#9a7c24',
      rec: '#c23b22',
      fg: '#1a221c',
      card: '#f3f5f1',
      ink: '#111914',
      mute: '#647066',
      surface: '#e8eee8',
      border: '#b0beb4',
      elevated: '#dee6df',
      glow: '#3f5f4c22',
    },
  },
  // 湿石板 + 油纸伞褪色紫，和青石的钢蓝分开
  lane: {
    id: 'lane',
    label: '雨巷',
    hint: '湿冷夜里',
    mode: 'dark',
    tokens: {
      cabinet: '#1b2224',
      wine: '#5a4954',
      foil: '#87a8a4',
      tungsten: '#c49a52',
      rec: '#d14a32',
      fg: '#dce6e4',
      card: '#e6ece8',
      ink: '#101615',
      mute: '#82908c',
      surface: '#252e30',
      border: '#42504e',
      elevated: '#2d383a',
      glow: '#87a8a422',
    },
  },
  // 冷瓷白，补上纸白/亚麻都偏奶油的空档
  moon: {
    id: 'moon',
    label: '月白',
    hint: '浅色 · 冷瓷',
    mode: 'light',
    tokens: {
      cabinet: '#e4e6e2',
      wine: '#4d4f4c',
      foil: '#6e726c',
      tungsten: '#a8882c',
      rec: '#c23b22',
      fg: '#1e221f',
      card: '#f7f7f4',
      ink: '#141613',
      mute: '#6e746e',
      surface: '#fbfbf8',
      border: '#c5c8c2',
      elevated: '#eef0ec',
      glow: '#6e726c22',
    },
  },
}

export const themeList = Object.values(themes)

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && value in themes)
}

export function applyThemeTokens(tokens: ThemeTokens) {
  const root = document.documentElement
  const map: Record<string, string> = {
    '--cabinet': tokens.cabinet,
    '--wine': tokens.wine,
    '--foil': tokens.foil,
    '--tungsten': tokens.tungsten,
    '--rec': tokens.rec,
    '--fg': tokens.fg,
    '--paper': tokens.fg,
    '--card': tokens.card,
    '--ink': tokens.ink,
    '--mute': tokens.mute,
    '--surface': tokens.surface,
    '--border': tokens.border,
    '--elevated': tokens.elevated,
    '--glow': tokens.glow,
  }
  for (const [key, value] of Object.entries(map)) {
    root.style.setProperty(key, value)
  }
}

export function buildAntTheme(appTheme: AppTheme): ThemeConfig {
  const { tokens, mode } = appTheme
  return {
    algorithm: mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: {
      colorPrimary: tokens.foil,
      colorInfo: tokens.foil,
      colorSuccess: tokens.tungsten,
      colorWarning: tokens.tungsten,
      colorError: tokens.rec,
      colorBgBase: tokens.cabinet,
      colorBgContainer: tokens.surface,
      colorBgElevated: tokens.elevated,
      colorTextBase: tokens.fg,
      colorText: tokens.fg,
      colorTextSecondary: tokens.mute,
      colorTextLightSolid: mode === 'light' ? tokens.card : tokens.ink,
      colorBorder: tokens.border,
      colorBorderSecondary: tokens.border,
      borderRadius: 2,
      fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif',
      fontSize: 15,
      controlHeight: 44,
    },
  }
}
