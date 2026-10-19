import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// The Gnipral mark keeps its content inside the maskable safe zone, so maskable and Apple icons
// use it full-bleed on the brand background instead of shrinking it with padding.
const BRAND_BACKGROUND = '#0F1B2D'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: BRAND_BACKGROUND } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: BRAND_BACKGROUND } },
  },
  images: ['public/icon.svg'],
})
