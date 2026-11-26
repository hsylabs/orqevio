import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.ORQEVIO_API ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // ws: live updates (/api/workspaces/:id/live) are WebSocket connections.
      '/api': { target: api, changeOrigin: false, ws: true },
      '/mcp': { target: api, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // KaTeX in files of its own (code and styles), still loaded with the editor. It imports
          // nothing, so their names change only when KaTeX, or the tools that build it, change:
          // the browser keeps them from one version of Orqevio to the next, rather than
          // downloading them again with every change to the editor.
          groups: [{ name: 'katex', test: /[\\/]node_modules[\\/]katex[\\/]/ }],
        },
      },
    },
  },
  worker: { format: 'es' },
})
