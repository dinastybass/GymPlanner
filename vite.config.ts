import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['assets/logo.png', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        id: '/',
        name: 'GymPlanner - GO & train',
        short_name: 'GO & train',
        description: 'Sistema integral de planificación de entrenamientos y agenda de sesiones para GO & train.',
        theme_color: '#0d9488',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        globIgnores: ['**/aistudio/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/__/, /googleapis\.com/]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    }),
    {
      name: 'exclude-aistudio-assets',
      closeBundle() {
        fs.rmSync(path.resolve(process.cwd(), 'dist', 'assets', 'aistudio'), {
          recursive: true,
          force: true
        });
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    hmr: false,
  },
});

