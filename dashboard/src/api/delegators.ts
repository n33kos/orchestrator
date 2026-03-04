import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody } from './helpers'

export function registerDelegatorRoutes(server: ViteDevServer) {
  // GET /api/delegators — delegator status
  server.middlewares.use('/api/delegators', (_req, res, next) => {
    if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }
    const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'delegator-status.sh')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'spawn-delegator.sh')
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
}
