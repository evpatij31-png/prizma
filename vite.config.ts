import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Relative base so the same build works from a file:// wrapper (Tauri / Capacitor).
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', not 'autoUpdate': the rule is that the page must never
      // reload under the user's hands, and `onNeedRefresh` — the hook the
      // banner needs — only fires in prompt mode. With autoUpdate the new
      // worker activates silently and there is nothing to offer.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Prizma Calendar',
        short_name: 'Prizma',
        description: 'Bright, offline-first calendar for web, desktop and mobile',
        lang: 'ru',
        theme_color: '#6d28d9',
        background_color: '#0b0a1a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // ICS feeds: network first, fall back to the last copy we fetched.
            urlPattern: /\.ics(\?.*)?$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ics-feeds',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // Bind IPv4 loopback explicitly. Vite's default resolves `localhost` to
    // ::1 only on this machine, and tooling that dials 127.0.0.1 then finds
    // nothing listening.
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
})
