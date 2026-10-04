import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const serverPort = process.env.PORT ?? '4788'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5788,
    proxy: { '/api': `http://127.0.0.1:${serverPort}` },
  },
})
