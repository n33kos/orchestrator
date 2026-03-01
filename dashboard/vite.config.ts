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
          if (body.pr_url !== undefined) item.pr_url = body.pr_url
          if (body.branch !== undefined) item.branch = body.branch

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

      // POST /api/stream/activate — activate a queued work item
      server.middlewares.use('/api/stream/activate', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const scriptPath = join(__dirname, '..', 'scripts', 'activate-stream.sh')
          const args = [body.itemId]
          if (body.quick) args.push('--quick')
          if (body.noDelegator) args.push('--no-delegator')
          execFile('bash', [scriptPath, ...args], { timeout: 120000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // POST /api/stream/teardown — tear down an active work stream
      server.middlewares.use('/api/stream/teardown', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const scriptPath = join(__dirname, '..', 'scripts', 'teardown-stream.sh')
          const args = [body.itemId]
          if (body.force) args.push('--force')
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

      // GET /api/health — orchestrator health check
      server.middlewares.use('/api/health', (_req, res) => {
        const scriptPath = join(__dirname, '..', 'scripts', 'health-check.sh')
        execFile('bash', [scriptPath, '--json'], { timeout: 15000, env: { ...process.env, HOME: homedir() } }, (err, stdout) => {
          res.setHeader('Content-Type', 'application/json')
          if (err) {
            res.end(JSON.stringify({ error: 'Health check failed', sessions: { total: 0, healthy: 0, zombie: 0 }, queue: { active_count: 0 } }))
            return
          }
          res.end(stdout)
        })
      })

      // POST /api/discover — trigger work discovery
      server.middlewares.use('/api/discover', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : {}
          const scriptPath = join(__dirname, '..', 'scripts', 'discover-work.py')
          const args = ['python3', scriptPath]
          if (body.dryRun) args.push('--dry-run')
          if (body.source) args.push('--source', body.source)
          execFile(args[0], args.slice(1), { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // POST /api/sessions/kill — kill a vmux session
      server.middlewares.use('/api/sessions/kill', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const vmuxPath = join(homedir(), '.local/bin/vmux')
          execFile(vmuxPath, ['kill', body.sessionId], { timeout: 10000 }, (err, stdout, stderr) => {
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

      // POST /api/sessions/reconnect — reconnect a zombie session
      server.middlewares.use('/api/sessions/reconnect', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const vmuxPath = join(homedir(), '.local/bin/vmux')
          execFile(vmuxPath, ['reconnect', body.cwd], { timeout: 15000 }, (err, stdout, stderr) => {
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

      // GET /api/delegators — delegator status
      server.middlewares.use('/api/delegators', (_req, res) => {
        const scriptPath = join(__dirname, '..', 'scripts', 'delegator-status.sh')
        execFile('bash', [scriptPath, '--json'], { timeout: 10000, env: { ...process.env, HOME: homedir() } }, (err, stdout) => {
          res.setHeader('Content-Type', 'application/json')
          if (err) {
            res.end(JSON.stringify({ delegators: [] }))
            return
          }
          try {
            res.end(stdout)
          } catch {
            res.end(JSON.stringify({ delegators: [] }))
          }
        })
      })

      // POST /api/delegators/spawn — spawn a delegator for a work item
      server.middlewares.use('/api/delegators/spawn', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const scriptPath = join(__dirname, '..', 'scripts', 'spawn-delegator.sh')
          execFile('bash', [scriptPath, body.itemId], { timeout: 60000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // GET /api/pr-status — fetch PR status from GitHub
      server.middlewares.use('/api/pr-status', (req, res) => {
        const url = new URL(req.url || '', 'http://localhost')
        const prUrl = url.searchParams.get('url')
        if (!prUrl) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing url param' })); return }

        // Extract owner/repo/number from GitHub PR URL
        const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
        if (!match) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ state: 'unknown', url: prUrl }))
          return
        }

        const [, owner, repo, number] = match
        execFile('gh', ['pr', 'view', number, '--repo', `${owner}/${repo}`, '--json', 'state,reviewDecision,statusCheckRollup,mergeable,title,additions,deletions,changedFiles,reviews,createdAt,updatedAt'], { timeout: 15000 }, (err, stdout) => {
          res.setHeader('Content-Type', 'application/json')
          if (err) {
            res.end(JSON.stringify({ state: 'unknown', url: prUrl, error: 'Failed to fetch PR status' }))
            return
          }
          try {
            const pr = JSON.parse(stdout)
            const reviews = (pr.reviews || []).map((r: { state: string; author: { login: string } }) => ({
              state: r.state,
              author: r.author?.login,
            }))
            const checks = (pr.statusCheckRollup || []).map((c: { name: string; status: string; conclusion: string }) => ({
              name: c.name,
              status: c.status,
              conclusion: c.conclusion,
            }))
            const checksPass = checks.length > 0 && checks.every((c: { conclusion: string }) => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
            const checksFail = checks.some((c: { conclusion: string }) => c.conclusion === 'FAILURE')
            const checksPending = checks.some((c: { status: string }) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED')

            res.end(JSON.stringify({
              state: pr.state,
              reviewDecision: pr.reviewDecision || null,
              mergeable: pr.mergeable,
              title: pr.title,
              additions: pr.additions,
              deletions: pr.deletions,
              changedFiles: pr.changedFiles,
              reviews,
              checksPass,
              checksFail,
              checksPending,
              checksTotal: checks.length,
              createdAt: pr.createdAt,
              updatedAt: pr.updatedAt,
              url: prUrl,
            }))
          } catch {
            res.end(JSON.stringify({ state: 'unknown', url: prUrl }))
          }
        })
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
