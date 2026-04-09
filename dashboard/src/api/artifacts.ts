import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readQueue, readConfigWithLocal } from './helpers'

function getArtifactsDir(): string {
  try {
    const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')
    const content = readConfigWithLocal(configPath)
    const match = content.match(/^\s*artifacts_directory:\s*(.+)$/m)
    if (match) return match[1].trim().replace('~', homedir())
  } catch {}
  return join(homedir(), '.claude', 'orchestrator', 'plans')
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.js': 'application/javascript',
}

export function registerArtifactRoutes(server: ViteDevServer) {
  // GET /api/queue/:id/artifacts — list artifact output_paths for a queue item
  server.middlewares.use('/api/queue/', (req, res, next) => {
    const url = new URL(req.url || '', 'http://localhost')
    const match = url.pathname.match(/^\/([^/]+)\/artifacts$/)
    if (!match || req.method !== 'GET') { next(); return }

    const itemId = decodeURIComponent(match[1])
    try {
      const data = readQueue()
      const item = data.items.find((i: { id: string }) => i.id === itemId)
      if (!item) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Item not found' })); return }

      const directives = item.runtime?.directives || {}
      const artifacts: Array<{ directive: string; output_path: string; exists: boolean }> = []

      for (const [name, state] of Object.entries(directives)) {
        const s = state as Record<string, unknown>
        if (s.output_path && typeof s.output_path === 'string') {
          const expanded = s.output_path.replace('~', homedir())
          artifacts.push({
            directive: name,
            output_path: s.output_path,
            exists: existsSync(expanded),
          })
        }
      }

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ item_id: itemId, artifacts }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // GET /api/artifacts/* — serve an artifact file
  server.middlewares.use('/api/artifacts', (req, res) => {
    if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return }

    const url = new URL(req.url || '', 'http://localhost')
    const filePath = decodeURIComponent(url.pathname.slice(1)) // Remove leading /

    if (!filePath) {
      // List all files in the artifacts directory
      const dir = getArtifactsDir()
      if (!existsSync(dir)) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ files: [], dir }))
        return
      }
      const files = readdirSync(dir).map(f => ({
        name: f,
        size: statSync(join(dir, f)).size,
        ext: extname(f),
      }))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ files, dir }))
      return
    }

    // Resolve the file: try artifacts dir first, then absolute path
    let fullPath = join(getArtifactsDir(), filePath)
    if (!existsSync(fullPath) && filePath.startsWith('/')) {
      fullPath = filePath
    }

    // Security: reject path traversal attempts
    const artifactsDir = getArtifactsDir()
    const resolvedInDir = join(artifactsDir, filePath)
    const isInArtifactsDir = resolvedInDir.startsWith(artifactsDir)
    const isAbsolute = filePath.startsWith('/')
    if (!isInArtifactsDir && !isAbsolute) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    if (!existsSync(fullPath)) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const ext = extname(fullPath).toLowerCase()
    res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream')
    res.end(readFileSync(fullPath))
  })
}
