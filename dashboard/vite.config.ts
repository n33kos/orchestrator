import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.API_PORT || '3200'
const apiTarget = `http://localhost:${apiPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3201,
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
})
