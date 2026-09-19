import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, presetAttributify, presetIcons, presetUno } from 'unocss'

const webRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.15,
      // 从仓库根跑 npm --prefix web 时 cwd 不在 web/，不指定会找不到 lucide
      collectionsNodeResolvePath: webRoot,
      collections: {
        lucide: () => import('@iconify-json/lucide/icons.json').then((mod) => mod.default),
      },
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
  theme: {
    colors: {
      cabinet: 'var(--cabinet)',
      wine: 'var(--wine)',
      foil: 'var(--foil)',
      tungsten: 'var(--tungsten)',
      rec: 'var(--rec)',
      fg: 'var(--fg)',
      paper: 'var(--fg)',
      card: 'var(--card)',
      ink: 'var(--ink)',
      mute: 'var(--mute)',
      surface: 'var(--surface)',
      border: 'var(--border)',
      elevated: 'var(--elevated)',
    },
    fontFamily: {
      display: '"ZCOOL XiaoWei", "Noto Serif SC", serif',
      sans: '"Noto Sans SC", "Source Han Sans SC", sans-serif',
      mono: '"IBM Plex Mono", ui-monospace, monospace',
    },
  },
  shortcuts: {
    'hit-44': 'min-h-11 min-w-11 inline-flex items-center justify-center cursor-pointer',
    'stamp': 'cursor-pointer border-none font-sans tracking-wide transition-opacity duration-200 hover:opacity-90 active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed',
    'writing-vertical-rl': '[writing-mode:vertical-rl] [text-orientation:upright]',
  },
})
