import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
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

      // POST /api/queue/blocker/add — add a blocker to a work item
      server.middlewares.use('/api/queue/blocker/add', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const data = readQueue()
          const item = data.items.find((i: { id: string }) => i.id === body.id)
          if (!item) { res.statusCode = 404; res.end('Not found'); return }
          if (!item.blockers) item.blockers = []
          const blockerId = `blk-${Date.now()}`
          const blocker = {
            id: blockerId,
            description: body.description,
            resolved: false,
            created_at: new Date().toISOString(),
            resolved_at: null,
          }
          item.blockers.push(blocker)
          writeQueue(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(blocker))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // PATCH /api/queue/blocker/resolve — resolve or unresolve a blocker
      server.middlewares.use('/api/queue/blocker/resolve', async (req, res) => {
        if (req.method !== 'PATCH') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const data = readQueue()
          const item = data.items.find((i: { id: string }) => i.id === body.id)
          if (!item) { res.statusCode = 404; res.end('Not found'); return }
          const blocker = (item.blockers || []).find((b: { id: string }) => b.id === body.blockerId)
          if (!blocker) { res.statusCode = 404; res.end('Blocker not found'); return }
          blocker.resolved = body.resolved ?? true
          blocker.resolved_at = blocker.resolved ? new Date().toISOString() : null
          writeQueue(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(blocker))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // PATCH /api/queue/reorder — swap priorities of two items
      server.middlewares.use('/api/queue/reorder', async (req, res) => {
        if (req.method !== 'PATCH') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const data = readQueue()
          const dragItem = data.items.find((i: { id: string }) => i.id === body.dragId)
          const dropItem = data.items.find((i: { id: string }) => i.id === body.dropId)
          if (!dragItem || !dropItem) { res.statusCode = 404; res.end('Item not found'); return }
          const tmpPriority = dragItem.priority
          dragItem.priority = dropItem.priority
          dropItem.priority = tmpPriority
          writeQueue(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
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

      // GET /api/sessions — list vmux sessions
      server.middlewares.use('/api/sessions', (_req, res) => {
        const vmuxPath = join(homedir(), '.local/bin/vmux')
        execFile(vmuxPath, ['sessions'], { timeout: 5000 }, (err, stdout) => {
          res.setHeader('Content-Type', 'application/json')
          if (err) {
            res.end(JSON.stringify({ sessions: [] }))
            return
          }
          const sessions: { id: string; state: string; cwd: string; tmux: string }[] = []
          const lines = stdout.split('\n')
          let i = 0
          while (i < lines.length) {
            const stateMatch = lines[i].match(/^\s+\[(\w+)\]\s+(\w+)/)
            if (stateMatch) {
              const state = stateMatch[1]
              const id = stateMatch[2]
              let cwd = ''
              let tmux = ''
              while (++i < lines.length && !lines[i].match(/^\s+\[/)) {
                const cwdMatch = lines[i].match(/cwd:\s+(.+)/)
                if (cwdMatch) cwd = cwdMatch[1].trim()
                const tmuxMatch = lines[i].match(/tmux:\s+(.+)/)
                if (tmuxMatch) tmux = tmuxMatch[1].trim()
              }
              sessions.push({ id, state, cwd, tmux })
            } else {
              i++
            }
          }
          res.end(JSON.stringify({ sessions }))
        })
      })

      // POST /api/sessions/send — send a message to a vmux session
      server.middlewares.use('/api/sessions/send', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const vmuxPath = join(homedir(), '.local/bin/vmux')
          execFile(vmuxPath, ['send', body.sessionId, body.text], { timeout: 10000 }, (err, stdout, stderr) => {
            res.setHeader('Content-Type', 'application/json')
            if (err) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: stderr || String(err) }))
              return
            }
            res.end(JSON.stringify({ ok: true, output: stdout.trim() }))
          })
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
