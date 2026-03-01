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

  function readQueue() {
    return JSON.parse(readFileSync(queuePath, 'utf-8'))
  }

  function writeQueue(data: Record<string, unknown>) {
    writeFileSync(queuePath, JSON.stringify(data, null, 2) + '\n')
  }

  return {
    name: 'queue-api',
    configureServer(server) {
      // POST /api/queue/add — add a new work item
      server.middlewares.use('/api/queue/add', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const data = readQueue()
          const maxId = data.items.reduce((max: number, i: { id: string }) => {
            const n = parseInt(i.id.replace('ws-', ''), 10)
            return n > max ? n : max
          }, 0)
          const newItem = {
            id: `ws-${String(maxId + 1).padStart(3, '0')}`,
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
          writeQueue(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(newItem))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // PATCH /api/queue/update — update a work item's fields
      server.middlewares.use('/api/queue/update', async (req, res) => {
        if (req.method !== 'PATCH') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const data = readQueue()
          const item = data.items.find((i: { id: string }) => i.id === body.id)
          if (!item) { res.statusCode = 404; res.end('Not found'); return }

          if (body.status !== undefined) item.status = body.status
          if (body.priority !== undefined) item.priority = body.priority
          if (body.title !== undefined) item.title = body.title
          if (body.description !== undefined) item.description = body.description
          if (body.delegator_enabled !== undefined) item.delegator_enabled = body.delegator_enabled

          writeQueue(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(item))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // DELETE /api/queue/delete — remove a work item
      server.middlewares.use('/api/queue/delete', async (req, res) => {
        if (req.method !== 'DELETE') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const data = readQueue()
          data.items = data.items.filter((i: { id: string }) => i.id !== body.id)
          writeQueue(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // GET /api/queue — read the queue
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
