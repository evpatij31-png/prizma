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
        // The desktop and mobile layers are unreachable in a browser: nothing
        // there can import them, because `bootstrapPlatform` only reaches for
        // them when it detects Tauri or Capacitor. Precaching them would make
        // every web visitor download ~18 KB they can never run and keep it in
        // their offline cache. The wrappers load from disk, not from here.
        globIgnores: ['**/native-*.js'],
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
  build: {
    rollupOptions: {
      output: {
        /**
         * Give every native-only module a `native-` filename.
         *
         * Not for size — these chunks are already lazy — but so the service
         * worker can recognise them by name and leave them out of the
         * precache. Matching on content or on the hashed default names would
         * break the first time a dependency moved.
         */
        manualChunks(id) {
          if (id.includes('platform.desktop') || id.includes('@tauri-apps')) return 'native-desktop'
          if (id.includes('platform.mobile') || id.includes('@capacitor')) return 'native-mobile'
          return undefined
        },
      },
    },
  },
  server: {
    // Bind IPv4 loopback explicitly. Vite's default resolves `localhost` to
    // ::1 only on this machine, and tooling that dials 127.0.0.1 then finds
    // nothing listening.
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
})
