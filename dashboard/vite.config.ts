import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { registerAllRoutes } from './src/api/index'

function queueApiPlugin(): Plugin {
  return {
    name: 'queue-api',
    configureServer(server) {
      registerAllRoutes(server)
    },
  }
}

export default defineConfig({
  plugins: [react(), queueApiPlugin()],
  server: {
    port: 3201,
    hmr: {
      overlay: false,
    },
  },
})
