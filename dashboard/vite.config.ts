import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs'
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

/**
 * Read a YAML config file, merging a .local.yml override if it exists.
 * Returns the merged content as a string (for regex-based value extraction).
 */
function readConfigWithLocal(basePath: string): string {
  let content = readFileSync(basePath, 'utf-8')
  const localPath = basePath.replace(/\.yml$/, '.local.yml')
  if (existsSync(localPath)) {
    // Merge local overrides: for each key-value in local, replace in merged content
    const localContent = readFileSync(localPath, 'utf-8')
    for (const line of localContent.split('\n')) {
      const kvMatch = line.match(/^(\s+)(\w+):\s*(.+)/)
      if (kvMatch) {
        const [, indent, key, val] = kvMatch
        const pattern = new RegExp(`^(\\s+${key}:\\s*).+$`, 'm')
        if (pattern.test(content)) {
          content = content.replace(pattern, `${indent}${key}: ${val}`)
        } else {
          // Key exists only in local — append after last line of the relevant section
          content += `\n${indent}${key}: ${val}`
        }
      }
    }
  }
  return content
}

/**
 * Get the local config override path for writes.
 * Creates the local file from the base if it doesn't exist.
 */
function getLocalConfigPath(basePath: string): string {
  const localPath = basePath.replace(/\.yml$/, '.local.yml')
  if (!existsSync(localPath)) {
    writeFileSync(localPath, '# Local overrides (not committed)\n')
  }
  return localPath
}

/**
 * Write a setting to the local config override file.
 * If the key already exists in the local file, update it.
 * If not, find the section and add the key.
 */
function writeLocalConfig(basePath: string, pattern: RegExp, replacement: string) {
  const localPath = getLocalConfigPath(basePath)
  let content = readFileSync(localPath, 'utf-8')
  if (pattern.test(content)) {
    content = content.replace(pattern, replacement)
  } else {
    // Read the base config to find which section the key belongs to
    const baseContent = readFileSync(basePath, 'utf-8')
    // Extract the key name from the pattern source
    const keyMatch = replacement.match(/^\s*(\w+):/)
    if (keyMatch) {
      const key = keyMatch[1]
      // Find the section this key belongs to in the base config
      let section = ''
      for (const line of baseContent.split('\n')) {
        const sectionMatch = line.match(/^(\w[^:]*):$/)
        if (sectionMatch) section = sectionMatch[1]
        if (line.match(new RegExp(`^\\s+${key}:`))) break
      }
      // Add section header if not in local file, then add key
      if (section && !content.includes(`${section}:`)) {
        content += `\n${section}:\n`
      }
      content += replacement.replace(/^\$1/, '  ') + '\n'
    }
  }
  writeFileSync(localPath, content, 'utf-8')
}

function queueApiPlugin(): Plugin {
  const queuePath = join(homedir(), '.claude/orchestrator/queue.json')

  function ensureQueue() {
    const dir = join(homedir(), '.claude/orchestrator')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    if (!existsSync(queuePath)) {
      writeFileSync(queuePath, JSON.stringify({ items: [] }, null, 2) + '\n')
    }
  }

  function readQueue() {
    ensureQueue()
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
            type: body.type || 'project',
            priority: body.priority || data.items.length + 1,
            status: 'planning',
            branch: body.branch || '',
            worktree_path: null,
            session_id: null,
            delegator_id: null,
            delegator_enabled: true,
            blockers: [],
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
            const suspendScript = join(__dirname, '..', 'scripts', 'suspend-stream.sh')
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

      // POST /api/queue/blocker/add — add a blocker to a work item
      server.middlewares.use('/api/queue/blocker/add', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          if (!body.id) { res.statusCode = 400; res.end(JSON.stringify({ error: 'id is required' })); return }
          if (!body.description) { res.statusCode = 400; res.end(JSON.stringify({ error: 'description is required' })); return }
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

      // GET /api/sessions — list vmux sessions
      server.middlewares.use('/api/sessions', (_req, res, next) => {
        if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }
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
          if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
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

      // POST /api/stream/suspend — suspend a stream for review (kill session + delegator, keep worktree)
      server.middlewares.use('/api/stream/suspend', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
          const scriptPath = join(__dirname, '..', 'scripts', 'suspend-stream.sh')
          const args = [scriptPath, body.itemId]
          if (body.targetStatus) args.push('--status', body.targetStatus)
          execFile('bash', args, { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // POST /api/stream/resume — resume a suspended stream (respawn session + delegator)
      server.middlewares.use('/api/stream/resume', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
          const scriptPath = join(__dirname, '..', 'scripts', 'resume-stream.sh')
          const args = [body.itemId]
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
          if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
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
      server.middlewares.use('/api/health', (_req, res, next) => {
        if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }
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

      // POST /api/health/recover — auto-recover zombie sessions
      server.middlewares.use('/api/health/recover', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        const scriptPath = join(__dirname, '..', 'scripts', 'health-check.sh')
        execFile('bash', [scriptPath, '--auto-recover'], { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
          res.setHeader('Content-Type', 'application/json')
          if (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: stderr || String(err), output: stdout }))
            return
          }
          res.end(JSON.stringify({ ok: true, output: stdout }))
        })
      })

      // GET /api/events — read recent events from the event log
      server.middlewares.use('/api/events', (req, res) => {
        const url = new URL(req.url || '', 'http://localhost')
        const limit = parseInt(url.searchParams.get('limit') || '50', 10)
        const since = url.searchParams.get('since') || ''
        const eventsFile = join(homedir(), '.claude/orchestrator/events.jsonl')

        res.setHeader('Content-Type', 'application/json')
        if (!existsSync(eventsFile)) {
          res.end(JSON.stringify({ events: [] }))
          return
        }

        try {
          const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n').filter(Boolean)
          let events = lines.map(line => {
            try { return JSON.parse(line) }
            catch { return null }
          }).filter(Boolean)

          if (since) {
            events = events.filter((e: { timestamp: string }) => e.timestamp > since)
          }

          // Return most recent events (tail)
          events = events.slice(-limit)
          res.end(JSON.stringify({ events }))
        } catch {
          res.end(JSON.stringify({ events: [] }))
        }
      })

      // GET /api/discover/sources — list configured work discovery sources
      server.middlewares.use('/api/discover/sources', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const sourcesPath = join(__dirname, '..', 'config', 'sources.yml')
          const content = readConfigWithLocal(sourcesPath)
          const sources: { name: string; type: string; detail: string }[] = []
          let currentName = ''
          let currentType = ''
          let currentDetail = ''

          for (const line of content.split('\n')) {
            const nameMatch = line.match(/^  (\S[^:]+):/)
            if (nameMatch && !line.trim().startsWith('#')) {
              if (currentName) sources.push({ name: currentName, type: currentType, detail: currentDetail })
              currentName = nameMatch[1]
              currentType = ''
              currentDetail = ''
              continue
            }
            const typeMatch = line.match(/^\s+type:\s*(.+)/)
            if (typeMatch) { currentType = typeMatch[1].trim(); continue }
            const repoMatch = line.match(/^\s+repo:\s*(.+)/)
            if (repoMatch) { currentDetail = repoMatch[1].trim(); continue }
            const pathMatch = line.match(/^\s+path:\s*(.+)/)
            if (pathMatch && !currentDetail) { currentDetail = pathMatch[1].trim(); continue }
            const domainMatch = line.match(/^\s+domain:\s*(.+)/)
            if (domainMatch && !currentDetail) { currentDetail = domainMatch[1].trim(); continue }
          }
          if (currentName) sources.push({ name: currentName, type: currentType, detail: currentDetail })

          res.end(JSON.stringify({ sources }))
        } catch {
          res.end(JSON.stringify({ sources: [] }))
        }
      })

      // POST /api/discover — trigger work discovery
      server.middlewares.use('/api/discover', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : {}
          const scriptPath = join(__dirname, '..', 'scripts', 'discover-work.py')
          const args = ['python3', scriptPath]
          if (body.dryRun) args.push('--output-json')
          if (body.source) args.push('--source', body.source)
          execFile(args[0], args.slice(1), { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
            res.setHeader('Content-Type', 'application/json')
            if (err) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: stderr || String(err), output: stdout }))
              return
            }
            if (body.dryRun) {
              try {
                const items = JSON.parse(stdout)
                res.end(JSON.stringify({ ok: true, items, output: stdout }))
              } catch {
                res.end(JSON.stringify({ ok: true, items: [], output: stdout }))
              }
            } else {
              res.end(JSON.stringify({ ok: true, output: stdout }))
            }
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
      server.middlewares.use('/api/delegators', (_req, res, next) => {
        if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }
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

      // GET /api/pr-stack — fetch status for all PRs in a Graphite stack
      server.middlewares.use('/api/pr-stack', (req, res) => {
        const url = new URL(req.url || '', 'http://localhost')
        const prUrl = url.searchParams.get('url')
        const basePr = url.searchParams.get('base')
        if (!prUrl && !basePr) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing url or base param' })); return }

        // Extract owner/repo from URL, or use base PR number
        let owner = '', repo = '', baseNumber = basePr || ''
        if (prUrl) {
          const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
          if (match) {
            owner = match[1]; repo = match[2]; baseNumber = match[3]
          }
        }

        // Use gh to find PRs from the same author whose branch starts with the same prefix
        execFile('gh', ['pr', 'view', baseNumber, '--repo', `${owner}/${repo}`, '--json', 'headRefName,author'], { timeout: 10000 }, (err, stdout) => {
          res.setHeader('Content-Type', 'application/json')
          if (err) { res.end(JSON.stringify({ prs: [], error: 'Failed to fetch base PR' })); return }

          try {
            const basePrData = JSON.parse(stdout)
            const branch = basePrData.headRefName || ''
            const author = basePrData.author?.login || ''
            // Extract the branch prefix (e.g., "user/project/name" from "user/project/name/1/description")
            const parts = branch.split('/')
            const prefix = parts.length > 3 ? parts.slice(0, 3).join('/') : branch

            execFile('gh', ['pr', 'list', '--repo', `${owner}/${repo}`, '--author', author, '--search', `is:pr head:${prefix}`, '--json', 'number,title,state,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,headRefName', '--limit', '20'], { timeout: 15000 }, (err2, stdout2) => {
              if (err2) { res.end(JSON.stringify({ prs: [], error: 'Failed to list stack PRs' })); return }

              try {
                const prs = JSON.parse(stdout2)
                  .sort((a: { number: number }, b: { number: number }) => a.number - b.number)
                  .map((pr: Record<string, unknown>) => {
                    const checks = ((pr.statusCheckRollup || []) as { conclusion: string; status: string }[])
                    const checksPass = checks.length > 0 && checks.every(c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
                    const checksFail = checks.some(c => c.conclusion === 'FAILURE')
                    return {
                      number: pr.number,
                      title: pr.title,
                      state: pr.state,
                      reviewDecision: pr.reviewDecision || null,
                      additions: pr.additions,
                      deletions: pr.deletions,
                      changedFiles: pr.changedFiles,
                      branch: pr.headRefName,
                      checksPass,
                      checksFail,
                      url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
                    }
                  })

                const graphiteStackUrl = prs.length > 0
                  ? `https://app.graphite.dev/github/pr/${owner}/${repo}/${prs[0].number}`
                  : null

                res.end(JSON.stringify({ prs, graphiteStackUrl, prefix }))
              } catch { res.end(JSON.stringify({ prs: [] })) }
            })
          } catch { res.end(JSON.stringify({ prs: [] })) }
        })
      })

      // POST /api/plan/generate — generate an implementation plan for a work item
      server.middlewares.use('/api/plan/generate', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
          const scriptPath = join(__dirname, '..', 'scripts', 'generate-plan.sh')
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
            const configPath = join(__dirname, '..', 'config', 'environment.yml')
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
            const configPath = join(__dirname, '..', 'config', 'environment.yml')
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
          // Also update inline plan if it exists
          if (item.metadata.plan) {
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

      // POST /api/training/run — run profile training on a session transcript
      server.middlewares.use('/api/training/run', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const scriptPath = join(__dirname, '..', 'scripts', 'train-profile.py')
          // If no session path, find the most recent orchestrator session transcript
          let sessionPath = body.sessionPath
          if (!sessionPath) {
            const projectsDir = join(homedir(), '.claude/projects')
            // Find the most recent .jsonl file
            const { readdirSync, statSync } = await import('fs')
            const files: { path: string; mtime: number }[] = []
            try {
              for (const dir of readdirSync(projectsDir)) {
                const dirPath = join(projectsDir, dir)
                try {
                  for (const file of readdirSync(dirPath)) {
                    if (file.endsWith('.jsonl')) {
                      const filePath = join(dirPath, file)
                      files.push({ path: filePath, mtime: statSync(filePath).mtimeMs })
                    }
                  }
                } catch { /* skip */ }
              }
            } catch { /* skip */ }
            files.sort((a, b) => b.mtime - a.mtime)
            sessionPath = files[0]?.path
          }

          if (!sessionPath) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'No session transcript found' }))
            return
          }

          const args = [scriptPath, sessionPath]
          if (body.lastN) args.push('--last-n', String(body.lastN))
          execFile('python3', args, { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // GET/PUT /api/training/profile — read or update the user profile
      server.middlewares.use('/api/training/profile', async (req, res) => {
        const profilePath = join(homedir(), '.claude/orchestrator/profile.md')
        res.setHeader('Content-Type', 'application/json')

        if (req.method === 'PUT') {
          try {
            const body = JSON.parse(await readBody(req))
            if (!body.content || typeof body.content !== 'string') {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Missing content field' }))
              return
            }
            writeFileSync(profilePath, body.content, 'utf-8')
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        try {
          const content = readFileSync(profilePath, 'utf-8')
          res.end(JSON.stringify({ content, path: profilePath }))
        } catch {
          res.end(JSON.stringify({ content: null, error: 'Profile not found. Run preseed-profile.py first.' }))
        }
      })

      // POST /api/training/preseed — run preseed to bootstrap profile
      server.middlewares.use('/api/training/preseed', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const scriptPath = join(__dirname, '..', 'scripts', 'preseed-profile.py')
          execFile('python3', [scriptPath], { timeout: 60000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // POST /api/scheduler/cleanup — archive old completed items
      server.middlewares.use('/api/scheduler/cleanup', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const scriptPath = join(__dirname, '..', 'scripts', 'scheduler.sh')
          execFile('bash', [scriptPath, '--cleanup', '--once'], { timeout: 15000, env: { ...process.env, HOME: homedir() } }, (err, stdout, stderr) => {
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

      // POST /api/scheduler/run — run the scheduler once
      server.middlewares.use('/api/scheduler/run', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : {}
          const scriptPath = join(__dirname, '..', 'scripts', 'scheduler.sh')
          const args = ['--once']
          if (body.dryRun) args.push('--dry-run')
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

      // GET/POST /api/orchestrator/pause — get or toggle orchestrator pause state
      const pauseFilePath = join(homedir(), '.claude/orchestrator/paused')
      server.middlewares.use('/api/orchestrator/pause', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET') {
          const paused = existsSync(pauseFilePath)
          res.end(JSON.stringify({ paused }))
          return
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        try {
          const body = JSON.parse(await readBody(req))
          const shouldPause = body.paused !== undefined ? body.paused : !existsSync(pauseFilePath)

          if (shouldPause) {
            // Create pause file
            writeFileSync(pauseFilePath, new Date().toISOString(), 'utf-8')
            // Update auto_activate to false in local config override
            const configPath = join(__dirname, '..', 'config', 'environment.yml')
            writeLocalConfig(configPath, /^(\s*auto_activate:\s*).+$/m, '  auto_activate: false')
            // Kill all delegators (read session IDs from queue file)
            const vmuxPath = join(homedir(), '.local/bin/vmux')
            const queuePath = join(homedir(), '.claude/orchestrator/queue.json')
            if (existsSync(queuePath)) {
              try {
                const queue = JSON.parse(readFileSync(queuePath, 'utf-8'))
                for (const item of queue.items || []) {
                  if (item.delegator_id && item.status === 'active') {
                    execFile(vmuxPath, ['kill', item.delegator_id], { env: { ...process.env, HOME: homedir() } }, () => {})
                  }
                }
              } catch (_e) { /* ignore parse errors */ }
            }
            res.end(JSON.stringify({ paused: true, message: 'Orchestration paused. Auto-activate disabled, delegators killed.' }))
          } else {
            // Remove pause file
            if (existsSync(pauseFilePath)) unlinkSync(pauseFilePath)
            // Update auto_activate to true in local config override
            const configPath = join(__dirname, '..', 'config', 'environment.yml')
            writeLocalConfig(configPath, /^(\s*auto_activate:\s*).+$/m, '  auto_activate: true')
            res.end(JSON.stringify({ paused: false, message: 'Orchestration resumed. Auto-activate enabled.' }))
          }
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // GET /api/config — read environment.yml as structured settings
      server.middlewares.use('/api/config', async (req, res) => {
        if (req.method === 'PATCH') {
          try {
            const body = JSON.parse(await readBody(req))
            const configPath = join(__dirname, '..', 'config', 'environment.yml')

            // Map setting keys to YAML key names and their sections
            const mappings: Record<string, { key: string; section: string }> = {
              maxConcurrentProjects: { key: 'max_active_projects', section: 'concurrency' },
              maxConcurrentQuickFixes: { key: 'quick_fix_limit', section: 'concurrency' },
              autoActivate: { key: 'auto_activate', section: 'autonomy' },
              requireApprovedPlan: { key: 'require_approved_plan', section: 'autonomy' },
              defaultDelegatorEnabled: { key: 'enabled_by_default', section: 'delegator' },
              stallThresholdMinutes: { key: 'threshold_minutes', section: 'stall_detection' },
              archiveAfterDays: { key: 'archive_after_days', section: 'scheduler' },
              plansDirectory: { key: 'plans_directory', section: 'plans' },
              delegatorCycleInterval: { key: 'cycle_interval', section: 'delegator' },
            }

            // Write each setting to the local override file
            const localPath = getLocalConfigPath(configPath)
            let localContent = readFileSync(localPath, 'utf-8')

            for (const [settingKey, value] of Object.entries(body)) {
              const mapping = mappings[settingKey]
              if (!mapping) continue
              const { key, section } = mapping
              const linePattern = new RegExp(`^(\\s*${key}:\\s*).+$`, 'm')
              if (linePattern.test(localContent)) {
                localContent = localContent.replace(linePattern, `  ${key}: ${value}`)
              } else {
                // Ensure section header exists
                if (!localContent.includes(`${section}:`)) {
                  localContent += `\n${section}:\n`
                }
                // Insert key after section header
                localContent = localContent.replace(
                  new RegExp(`(${section}:\\n)`, 'm'),
                  `$1  ${key}: ${value}\n`
                )
              }
            }

            writeFileSync(localPath, localContent, 'utf-8')

            // Signal the scheduler to reload config immediately
            const schedulerPidFile = join(homedir(), '.claude/orchestrator/scheduler.pid')
            if (existsSync(schedulerPidFile)) {
              try {
                const pid = parseInt(readFileSync(schedulerPidFile, 'utf-8').trim(), 10)
                if (pid > 0) process.kill(pid, 'SIGUSR1')
              } catch { /* scheduler may not be running */ }
            }

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // GET — read config values (merged with local overrides)
        try {
          const configPath = join(__dirname, '..', 'config', 'environment.yml')
          const content = readConfigWithLocal(configPath)

          const getVal = (key: string) => {
            const match = content.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))
            return match ? match[1].trim() : null
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            maxConcurrentProjects: parseInt(getVal('max_active_projects') || '2', 10),
            maxConcurrentQuickFixes: parseInt(getVal('quick_fix_limit') || '4', 10),
            autoActivate: getVal('auto_activate') === 'true',
            requireApprovedPlan: getVal('require_approved_plan') === 'true',
            plansDirectory: getVal('plans_directory') || '~/.claude/orchestrator/plans',
            defaultDelegatorEnabled: getVal('enabled_by_default') === 'true',
            stallThresholdMinutes: parseInt(getVal('threshold_minutes') || '30', 10),
            archiveAfterDays: parseInt(getVal('archive_after_days') || '7', 10),
            delegatorCycleInterval: parseInt(getVal('cycle_interval')?.replace(/#.*/, '') || '300', 10),
          }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      // GET /api/status — combined system snapshot (queue + sessions + delegators + health)
      server.middlewares.use('/api/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const vmuxPath = join(homedir(), '.local/bin/vmux')
        const scriptDir = join(__dirname, '..', 'scripts')
        const execEnv = { ...process.env, HOME: homedir() }

        // Read queue synchronously (fast, local file)
        let queue = { version: 1, items: [] as Record<string, unknown>[] }
        try { queue = JSON.parse(readFileSync(queuePath, 'utf-8')) } catch { /* empty */ }

        // Run sessions, delegators, and health in parallel
        let pending = 3
        let sessions: Record<string, string>[] = []
        let delegators: Record<string, unknown>[] = []
        let health: Record<string, unknown> = {}

        function tryFinish() {
          if (--pending > 0) return
          res.end(JSON.stringify({ queue, sessions, delegators, health, timestamp: new Date().toISOString() }))
        }

        execFile(vmuxPath, ['sessions'], { timeout: 5000 }, (err, stdout) => {
          if (!err) {
            const parsed: { id: string; state: string; cwd: string; tmux: string }[] = []
            const lines = stdout.split('\n')
            let i = 0
            while (i < lines.length) {
              const m = lines[i].match(/^\s+\[(\w+)\]\s+(\w+)/)
              if (m) {
                const state = m[1], id = m[2]
                let cwd = '', tmux = ''
                while (++i < lines.length && !lines[i].match(/^\s+\[/)) {
                  const cwdM = lines[i].match(/cwd:\s+(.+)/)
                  if (cwdM) cwd = cwdM[1].trim()
                  const tmuxM = lines[i].match(/tmux:\s+(.+)/)
                  if (tmuxM) tmux = tmuxM[1].trim()
                }
                parsed.push({ id, state, cwd, tmux })
              } else { i++ }
            }
            sessions = parsed
          }
          tryFinish()
        })

        execFile('bash', [join(scriptDir, 'delegator-status.sh'), '--json'], { timeout: 10000, env: execEnv }, (err, stdout) => {
          if (!err) { try { delegators = JSON.parse(stdout).delegators || [] } catch { /* empty */ } }
          tryFinish()
        })

        execFile('bash', [join(scriptDir, 'health-check.sh'), '--json'], { timeout: 15000, env: execEnv }, (err, stdout) => {
          if (!err) { try { health = JSON.parse(stdout) } catch { /* empty */ } }
          tryFinish()
        })
      })

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
          if (body.prUrl) item.pr_url = body.prUrl
          if (!item.metadata) item.metadata = {}
          if (body.message) {
            item.metadata.completion_message = body.message
          }
          item.metadata.last_activity = new Date().toISOString()

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
            const scriptPath = join(__dirname, '..', 'scripts', 'teardown-stream.sh')
            execFile('bash', [scriptPath, body.itemId], { timeout: 60000, env: { ...process.env, HOME: homedir() } }, () => { /* fire and forget */ })
          }

          // If moving to review and sessions are still active, suspend the stream
          if (targetStatus === 'review' && (item.session_id || item.delegator_id)) {
            const suspendScript = join(__dirname, '..', 'scripts', 'suspend-stream.sh')
            execFile('bash', [suspendScript, body.itemId], { timeout: 30000, env: { ...process.env, HOME: homedir() } }, (err, _stdout, stderr) => {
              if (err) console.error('suspend-stream failed:', stderr || String(err))
            })
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, itemId: body.itemId, prevStatus, newStatus: targetStatus }))
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
    hmr: {
      overlay: false,
    },
  },
})
