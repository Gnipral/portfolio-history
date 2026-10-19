/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://gnipral.github.io/portfolio-history/
const base = '/portfolio-history/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      pwaAssets: { config: true },
      manifest: {
        name: 'Portfolio History',
        short_name: 'Portfolio',
        description: 'See the value and profit of your investment portfolio at any moment in its history.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#0f172a',
        background_color: '#0f172a',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Static FX/benchmark snapshots: show cached data offline, refresh when online.
            urlPattern: ({ url }) => url.pathname.startsWith(`${base}data/`),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'static-data' },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
