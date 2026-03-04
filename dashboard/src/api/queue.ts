import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody, readQueue, writeQueue, queuePath } from './helpers'

export function registerQueueRoutes(server: ViteDevServer) {
  // POST /api/queue/add — add a new work item
  server.middlewares.use('/api/queue/add', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
        res.statusCode = 400; res.end(JSON.stringify({ error: 'title is required' })); return
      }
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
        type: body.type || 'work_item',
        priority: body.priority || data.items.length + 1,
        status: 'planning',
        branch: body.branch || '',
        worktree_path: null,
        session_id: null,
        delegator_id: null,
        delegator_enabled: true,
        blocked_by: [],
        created_at: new Date().toISOString(),
        activated_at: null,
        completed_at: null,
        metadata: {
          source_ref: 'Dashboard — manual entry',
          ...(body.prType ? { pr_type: body.prType } : {}),
          ...(body.repoPath ? { repo_path: body.repoPath } : {}),
        },
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
      if (!body.id) { res.statusCode = 400; res.end(JSON.stringify({ error: 'id is required' })); return }
      const data = readQueue()
      const item = data.items.find((i: { id: string }) => i.id === body.id)
      if (!item) { res.statusCode = 404; res.end('Not found'); return }

      // Validate status transitions
      if (body.status !== undefined && body.status !== item.status) {
        const validTransitions: Record<string, string[]> = {
          queued: ['planning', 'active', 'paused'],
          planning: ['queued', 'active', 'paused'],
          active: ['review', 'paused', 'completed'],
          review: ['active', 'paused', 'completed'],
          paused: ['queued', 'planning', 'active', 'review'],
          completed: ['queued'], // Allow re-queuing completed items
        }
        const allowed = validTransitions[item.status] || []
        if (!allowed.includes(body.status)) {
          res.statusCode = 409
          res.end(JSON.stringify({ error: `Invalid transition: ${item.status} → ${body.status}` }))
          return
        }
      }

      if (body.status !== undefined) item.status = body.status
      if (body.priority !== undefined) item.priority = body.priority
      if (body.title !== undefined) item.title = body.title
      if (body.description !== undefined) item.description = body.description
      if (body.delegator_enabled !== undefined) item.delegator_enabled = body.delegator_enabled
      if (body.pr_url !== undefined) item.pr_url = body.pr_url
      if (body.branch !== undefined) item.branch = body.branch
      if (body.metadata !== undefined) {
        if (!item.metadata) item.metadata = {}
        Object.assign(item.metadata, body.metadata)
      }

      // Auto-update last_activity for stall detection
      if (body.status || body.metadata || body.pr_url) {
        if (!item.metadata) item.metadata = {}
        item.metadata.last_activity = new Date().toISOString()
      }

      writeQueue(data)

      // NOTE: The scheduler's reconcile_state() is the PRIMARY mechanism for
      // ensuring active items have sessions and review items do not. It runs
      // every polling cycle and enforces desired state regardless of how items
      // got into their current status.

      // Supplementary fast-path: suspend sessions immediately when moving to
      // review (belt-and-suspenders — scheduler reconciliation will also catch this)
      const targetStatus = body.status
      if (targetStatus === 'review' && (item.session_id || item.delegator_id)) {
        const suspendScript = join(__dirname, '..', '..', '..', 'scripts', 'suspend-stream.sh')
        execFile('bash', [suspendScript, body.id], { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, _stdout, stderr) => {
          if (err) console.error('suspend-stream failed:', stderr || String(err))
        })
      }

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(item))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // PATCH /api/queue/blocked-by/update — update the blocked_by list for a work item
  server.middlewares.use('/api/queue/blocked-by/update', async (req, res) => {
    if (req.method !== 'PATCH') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.id) { res.statusCode = 400; res.end(JSON.stringify({ error: 'id is required' })); return }
      if (!Array.isArray(body.blocked_by)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'blocked_by must be an array' })); return }
      const data = readQueue()
      const item = data.items.find((i: { id: string }) => i.id === body.id)
      if (!item) { res.statusCode = 404; res.end('Not found'); return }
      item.blocked_by = body.blocked_by
      writeQueue(data)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(item))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // PATCH /api/queue/reorder — move dragged item to drop position and renumber
  server.middlewares.use('/api/queue/reorder', async (req, res) => {
    if (req.method !== 'PATCH') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      const data = readQueue()
      const dragIdx = data.items.findIndex((i: { id: string }) => i.id === body.dragId)
      const dropIdx = data.items.findIndex((i: { id: string }) => i.id === body.dropId)
      if (dragIdx === -1 || dropIdx === -1) { res.statusCode = 404; res.end('Item not found'); return }
      // Sort items by the same display order (status group, then priority)
      const statusOrder: Record<string, number> = { active: 0, review: 1, queued: 2, planning: 3, paused: 4, completed: 5 }
      const sorted = data.items
        .map((item: { id: string; status: string; priority: number }, i: number) => ({ item, origIdx: i }))
        .sort((a: { item: { status: string; priority: number } }, b: { item: { status: string; priority: number } }) => {
          const sd = (statusOrder[a.item.status] ?? 99) - (statusOrder[b.item.status] ?? 99)
          if (sd !== 0) return sd
          return a.item.priority - b.item.priority
        })
      // Find positions in the visual order
      const dragVisIdx = sorted.findIndex((e: { origIdx: number }) => e.origIdx === dragIdx)
      const dropVisIdx = sorted.findIndex((e: { origIdx: number }) => e.origIdx === dropIdx)
      // Remove drag item and re-insert at drop position
      const [dragEntry] = sorted.splice(dragVisIdx, 1)
      sorted.splice(dropVisIdx > dragVisIdx ? dropVisIdx : dropVisIdx, 0, dragEntry)
      // Renumber all priorities sequentially
      sorted.forEach((e: { item: { priority: number } }, i: number) => { e.item.priority = i + 1 })
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
      const item = data.items.find((i: { id: string }) => i.id === body.id)
      if (item && (item.status === 'active' || item.status === 'review')) {
        res.statusCode = 409
        res.end(JSON.stringify({ error: `Cannot delete ${item.status} item — suspend or complete it first` }))
        return
      }
      data.items = data.items.filter((i: { id: string }) => i.id !== body.id)
      writeQueue(data)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // GET /api/queue — read the queue (with one-time migration)
  server.middlewares.use('/api/queue', (_req, res) => {
    try {
      const data = readQueue()
      let migrated = false
      for (const item of data.items) {
        // Migrate metadata.blocked_by to top-level blocked_by
        if (item.metadata?.blocked_by && !item.blocked_by) {
          item.blocked_by = item.metadata.blocked_by
          delete item.metadata.blocked_by
          migrated = true
        }
        // Ensure blocked_by exists
        if (!Array.isArray(item.blocked_by)) {
          item.blocked_by = []
          migrated = true
        }
        // Remove old blockers field
        if ('blockers' in item) {
          delete item.blockers
          migrated = true
        }
      }
      if (migrated) {
        writeQueue(data)
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    } catch {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ version: 1, items: [] }))
    }
  })
}
