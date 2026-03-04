import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody } from './helpers'

export function registerTrainingRoutes(server: ViteDevServer) {
  // POST /api/training/run — run profile training on a session transcript
  server.middlewares.use('/api/training/run', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const body = JSON.parse(await readBody(req))
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'train-profile.py')
      // If no session path, find the most recent orchestrator session transcript
      let sessionPath = body.sessionPath
      if (!sessionPath) {
        const projectsDir = join(homedir(), '.claude/projects')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'preseed-profile.py')
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
}
