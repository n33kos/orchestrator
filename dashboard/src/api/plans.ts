import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody } from './helpers'

export function registerPlanRoutes(server: ViteDevServer) {
  // POST /api/plan/generate — generate an implementation plan for a work item
  server.middlewares.use('/api/plan/generate', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'generate-plan.sh')
      const args = [body.itemId]
      if (body.autoApprove) args.push('--auto-approve')
      execFile('bash', [scriptPath, ...args], { timeout: 60000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
        res.setHeader('Content-Type', 'application/json')
        if (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: stderr || String(err), output: stdout }))
          return
        }
        res.end(JSON.stringify({ ok: true, output: stdout }))
      })
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // GET /api/plan/file?itemId=ws-xxx — read plan file contents
  server.middlewares.use('/api/plan/file', (req, res) => {
    if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`)
      const itemId = url.searchParams.get('itemId')
      if (!itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }

      // Read queue to find plan_file path
      const queueData = JSON.parse(readFileSync(join(homedir(), '.claude/orchestrator/queue.json'), 'utf-8'))
      const item = queueData.items.find((i: Record<string, unknown>) => i.id === itemId)
      if (!item) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Item not found' })); return }

      const planFile = (item.metadata?.plan_file as string) || ''
      if (!planFile) {
        // Check default location
        const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')
        const configContent = readFileSync(configPath, 'utf-8')
        const dirMatch = configContent.match(/^\s*directory:\s*(.+)$/m)
        const plansDir = (dirMatch ? dirMatch[1].trim().replace('~', homedir()) : join(homedir(), '.claude/orchestrator/plans'))
        const defaultPath = join(plansDir, `${itemId}.md`)
        if (existsSync(defaultPath)) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ path: defaultPath, content: readFileSync(defaultPath, 'utf-8') }))
          return
        }
        res.statusCode = 404; res.end(JSON.stringify({ error: 'No plan file found' })); return
      }

      const expandedPath = planFile.replace('~', homedir())
      if (!existsSync(expandedPath)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Plan file not found', path: expandedPath })); return }

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ path: expandedPath, content: readFileSync(expandedPath, 'utf-8') }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // POST /api/plan/open — open plan file in default editor
  server.middlewares.use('/api/plan/open', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }

      // Read queue to find plan_file path
      const queueData = JSON.parse(readFileSync(join(homedir(), '.claude/orchestrator/queue.json'), 'utf-8'))
      const item = queueData.items.find((i: Record<string, unknown>) => i.id === body.itemId)
      if (!item) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Item not found' })); return }

      // Check metadata plan_file first, then default location
      let planPath = (item.metadata?.plan_file as string || '').replace('~', homedir())
      if (!planPath || !existsSync(planPath)) {
        const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')
        const configContent = readFileSync(configPath, 'utf-8')
        const dirMatch = configContent.match(/^\s*directory:\s*(.+)$/m)
        const plansDir = (dirMatch ? dirMatch[1].trim().replace('~', homedir()) : join(homedir(), '.claude/orchestrator/plans'))
        planPath = join(plansDir, `${body.itemId}.md`)
        // Create the file if it doesn't exist
        if (!existsSync(planPath)) {
          if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true })
          writeFileSync(planPath, `# ${item.title || body.itemId}\n\n## Summary\n\n\n## Steps\n\n- [ ] \n\n## Notes\n\n`, 'utf-8')
          // Update queue with plan_file reference
          item.metadata = item.metadata || {}
          item.metadata.plan_file = planPath
          writeFileSync(join(homedir(), '.claude/orchestrator/queue.json'), JSON.stringify(queueData, null, 2) + '\n', 'utf-8')
        }
      }

      execFile('open', [planPath], (err) => {
        res.setHeader('Content-Type', 'application/json')
        if (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
          return
        }
        res.end(JSON.stringify({ ok: true, path: planPath }))
      })
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // PATCH /api/plan/approve — toggle plan approval status
  server.middlewares.use('/api/plan/approve', async (req, res) => {
    if (req.method !== 'PATCH') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }

      const queuePath = join(homedir(), '.claude/orchestrator/queue.json')
      const queueData = JSON.parse(readFileSync(queuePath, 'utf-8'))
      const item = queueData.items.find((i: Record<string, unknown>) => i.id === body.itemId)
      if (!item) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Item not found' })); return }

      item.metadata = item.metadata || {}
      const approved = body.approved !== undefined ? body.approved : !item.metadata.plan_approved
      item.metadata.plan_approved = approved
      // Also update inline plan if it exists and is an object
      if (item.metadata.plan && typeof item.metadata.plan === 'object') {
        item.metadata.plan.approved = approved
        item.metadata.plan.approved_at = approved ? new Date().toISOString() : null
      }
      // Auto-transition: planning → queued when approved, queued → planning when revoked
      if (approved && item.status === 'planning') {
        item.status = 'queued'
      } else if (!approved && item.status === 'queued') {
        item.status = 'planning'
      }

      writeFileSync(queuePath, JSON.stringify(queueData, null, 2) + '\n', 'utf-8')

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, approved }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}
