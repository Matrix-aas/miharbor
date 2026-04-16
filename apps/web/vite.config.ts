import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Monaco's editor.api chunk is ~2.3MB raw / ~595KB gzip — expected for
    // a full editor runtime. We lazy-load it, so the main chunk stays lean.
    chunkSizeWarningLimit: 2600,
  },
  server: {
    port: 5173,
    proxy: {
      // Dev-time convenience: proxy API calls to the Miharbor server running
      // on :3000 so the browser can hit /api/* without CORS headaches.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
