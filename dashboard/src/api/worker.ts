import { appendFileSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody, readQueue, writeQueue } from './helpers'

export function registerWorkerRoutes(server: ViteDevServer) {
  // POST /api/worker/complete — workers report task completion
  server.middlewares.use('/api/worker/complete', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
      const data = readQueue()
      const item = data.items.find((i: { id: string }) => i.id === body.itemId)
      if (!item) { res.statusCode = 404; res.end(JSON.stringify({ error: `Item ${body.itemId} not found` })); return }

      const prevStatus = item.status
      const targetStatus = body.status || 'completed'
      if (!['completed', 'review'].includes(targetStatus)) {
        res.statusCode = 400; res.end(JSON.stringify({ error: 'status must be "completed" or "review"' })); return
      }

      item.status = targetStatus
      if (targetStatus === 'completed') {
        item.completed_at = new Date().toISOString()
      }
      if (!item.runtime) item.runtime = {}
      if (body.prUrl) item.runtime.pr_url = body.prUrl
      if (body.message) {
        item.runtime.completion_message = body.message
      }
      item.runtime.last_activity = new Date().toISOString()

      writeQueue(data)

      // Emit event
      const eventsFile = join(homedir(), '.claude/orchestrator/events.jsonl')
      const event = JSON.stringify({
        timestamp: new Date().toISOString(),
        type: targetStatus === 'completed' ? 'worker.completed' : 'worker.review',
        message: body.message || `Worker reported ${targetStatus} for ${body.itemId}`,
        severity: 'info',
        item_id: body.itemId,
      })
      try { appendFileSync(eventsFile, event + '\n') } catch { /* best effort */ }

      // If completed and teardown requested, kick off teardown in background
      if (targetStatus === 'completed' && body.teardown) {
        const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'teardown-stream.sh')
        execFile('bash', [scriptPath, body.itemId], { timeout: 60000, env: { ...process.env, HOME: homedir() } }, () => { /* fire and forget */ })
      }

      // Review items keep worker + delegator alive — no suspension needed.
      // Teardown only happens when moving to completed (handled above).

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, itemId: body.itemId, prevStatus, newStatus: targetStatus }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}
