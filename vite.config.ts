/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content-Security-Policy of the built app: only its own scripts run, so an injected script (say through a
 * broker file) cannot. Requests may go to any https host, because the price proxy URL is the user's choice.
 * Only in the build: the dev server needs inline scripts for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const csp = {
  name: 'content-security-policy',
  apply: 'build' as const,
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' as const }],
}

// Served from https://gnipral.github.io/portfolio-history/
const base = '/portfolio-history/'

export default defineConfig({
  base,
  plugins: [
    react(),
    csp,
    VitePWA({
      registerType: 'prompt',
      pwaAssets: { config: true },
      manifest: {
        name: 'Portfolio History',
        short_name: 'Portfolio',
        description: 'See the value and profit of your investment portfolio at any moment in its history.',
        lang: 'nl',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#0B0E12',
        background_color: '#0B0E12',
      },
      workbox: {
        // mjs: the pdf.js worker, so PDF statements can be imported offline too.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest,woff2}'],
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
    // The tests read the English texts; the app itself starts in Dutch.
    setupFiles: ['src/i18n/englishForTests.ts'],
  },
})
