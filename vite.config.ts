import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@app': r('./src/app'),
      '@adapters': r('./src/adapters'),
      '@content': r('./src/content'),
      '@test': r('./src/test'),
    },
  },
  server: { port: 5173, strictPort: true },
})
