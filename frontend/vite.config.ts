import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const backend =
    env.API_PROXY_TARGET || 'http://127.0.0.1:8000'

  const https =
    env.DEV_HTTPS_CERT && env.DEV_HTTPS_KEY
      ? {
          cert: readFileSync(env.DEV_HTTPS_CERT),
          key: readFileSync(env.DEV_HTTPS_KEY),
        }
      : undefined

  const proxy = {
    '/api': {
      target: backend,
    },
    '/ws': {
      target: backend,
      ws: true,
    },
  }

  return {
    plugins: [
      react(),

      VitePWA({
        registerType: 'prompt',
        injectRegister: false,

        manifest: {
          id: '/',
          name: 'GUARDIAN Core',
          short_name: 'GUARDIAN',
          lang: 'es',
          description:
            'Acompañamiento de trayectos con telemetría real.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#080b13',
          background_color: '#080b13',

          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },

        workbox: {
          globPatterns: [
            '**/*.{js,css,html,png,svg,woff2}',
          ],

          globIgnores: [
            'legacy/**',
          ],

          navigateFallback: '/index.html',

          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/ws\//,
            /^\/legacy\//,
          ],

          cleanupOutdatedCaches: true,

          runtimeCaching: [],
        },

        devOptions: {
          enabled: false,
        },
      }),
    ],

    server: {
      host: true,
      port: 5173,
      strictPort: true,
      https,
      proxy,
    },

    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      https,
      proxy,

      allowedHosts: [
        'wallet-striking-coordinated-each.trycloudflare.com',
      ],
    },
  }
})