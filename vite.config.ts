import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * GitHub Pages serves static files only: it has no rewrite rule, so a reload
 * or a shared link on a deep route — `/piano-learning-app/practice`, which the
 * shell's router owns (`src/app/shell/routing.ts`) — asks for a file that does
 * not exist. Pages answers such a request with `404.html`, so shipping the
 * app's own HTML under that name is the whole SPA fallback. The response still
 * carries a 404 status; browsers render the body regardless, and the router
 * reads the path it was asked for and lands on the right screen.
 */
const spaFallback = () => ({
  name: 'pages-404-fallback',
  apply: 'build' as const,
  closeBundle(): void {
    const dist = r('./dist')
    copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
  },
})

// Deployed to GitHub Pages at https://kcharecki.github.io/piano-learning-app/, so the
// production bundle needs its asset URLs prefixed with the repository name. Only the DEV
// server stays on `/`: e2e (`playwright.config.ts`) and every doc that says "navigate to
// http://localhost:5173" assume the root, and a base path there would break both.
//
// `vite preview` reports `command === 'serve'` like the dev server does, so keying on
// `command` alone silently serves dist/ at `/` — the built HTML then asks for
// `/piano-learning-app/assets/*` and every asset 404s. `isPreview` is what separates the two.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : '/piano-learning-app/',
  plugins: [react(), spaFallback()],
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
}))
