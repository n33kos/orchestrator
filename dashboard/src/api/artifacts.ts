import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import type { ViteDevServer } from 'vite'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.png': 'image/png',
}

export function registerArtifactRoutes(server: ViteDevServer) {
  server.middlewares.use('/api/artifact-file', (req, res) => {
    const url = new URL(req.url || '', 'http://localhost')
    const filePath = url.searchParams.get('path')

    if (!filePath) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Missing ?path= parameter' }))
      return
    }

    if (!existsSync(filePath)) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const ext = extname(filePath).toLowerCase()
    res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream')
    res.end(readFileSync(filePath))
  })
}
