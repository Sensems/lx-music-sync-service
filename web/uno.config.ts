import { defineConfig, presetAttributify, presetIcons, presetUno } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.15,
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
