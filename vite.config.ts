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
        theme_color: '#0B0E12',
        background_color: '#0B0E12',
      },
      workbox: {
        // mjs: the pdf.js worker, so PDF statements can be imported offline too.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Avatar and social preview are for GitHub, not for the app.
        globIgnores: ['brand/*.png'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Static FX/benchmark snapshots: show cached data offline, refresh when online.
            urlPattern: ({ url }) => url.pathname.startsWith(`${base}data/`),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'static-data' },
          },
          {
            // Web fonts: keep them offline; without them the system fonts take over.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'workers/**/*.test.ts'],
  },
})
