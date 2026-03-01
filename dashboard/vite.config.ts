import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Plugin } from 'vite'
import type { IncomingMessage } from 'http'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
  })
}

function queueApiPlugin(): Plugin {
  const queuePath = join(homedir(), '.claude/orchestrator/queue.json')

  return {
    name: 'queue-api',
    configureServer(server) {
      // GET /api/queue — read the queue
      server.middlewares.use('/api/queue/add', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = JSON.parse(await readBody(req))
          const data = JSON.parse(readFileSync(queuePath, 'utf-8'))

          const newItem = {
            id: `ws-${String(data.items.length + 1).padStart(3, '0')}`,
            source: 'manual',
            title: body.title,
            description: body.description || '',
            type: body.type || 'project',
            priority: body.priority || data.items.length + 1,
            status: 'queued',
            branch: body.branch || '',
            worktree_path: null,
            session_id: null,
            delegator_id: null,
            delegator_enabled: body.type === 'project',
            blockers: [],
            created_at: new Date().toISOString(),
            activated_at: null,
            completed_at: null,
            metadata: { source_ref: 'Dashboard — manual entry' },
          }

          data.items.push(newItem)
          writeFileSync(queuePath, JSON.stringify(data, null, 2) + '\n')

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(newItem))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      server.middlewares.use('/api/queue', (_req, res) => {
        try {
          const data = readFileSync(queuePath, 'utf-8')
          res.setHeader('Content-Type', 'application/json')
          res.end(data)
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ version: 1, items: [] }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), queueApiPlugin()],
  server: {
    port: 3201,
  },
})
