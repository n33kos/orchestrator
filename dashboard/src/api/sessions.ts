import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody } from './helpers'

export function registerSessionRoutes(server: ViteDevServer) {
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

  // POST /api/stream/activate — activate a queued work item
  server.middlewares.use('/api/stream/activate', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.itemId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'itemId is required' })); return }
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'activate-stream.sh')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'suspend-stream.sh')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'resume-stream.sh')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'teardown-stream.sh')
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
}
