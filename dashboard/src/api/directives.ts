import { execFile } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody } from './helpers'

const PROJECT_ROOT = join(homedir(), 'orchestrator')
const CONTROL_SCRIPT = join(PROJECT_ROOT, 'scripts', 'directive-control.py')

interface DirectiveSummary {
  name: string
  enabled: boolean
  required: boolean
  max_retries: number
  depends_on: string | null
  source: 'committed' | 'local'
  source_file: string
}

function parseFrontmatter(content: string): { fm: Record<string, string | number | boolean>; body: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!m) return { fm: {}, body: content }
  const fm: Record<string, string | number | boolean> = {}
  for (const line of m[1].split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const idx = t.indexOf(':')
    if (idx === -1) continue
    const key = t.slice(0, idx).trim()
    const val = t.slice(idx + 1).trim()
    if (val.toLowerCase() === 'true' || val.toLowerCase() === 'yes') {
      fm[key] = true
    } else if (val.toLowerCase() === 'false' || val.toLowerCase() === 'no') {
      fm[key] = false
    } else if (/^-?\d+$/.test(val)) {
      fm[key] = parseInt(val, 10)
    } else {
      fm[key] = val
    }
  }
  return { fm, body: m[2].trim() }
}

function loadFromDir(root: string, sourceLabel: 'committed' | 'local'): Record<string, DirectiveSummary[]> {
  const out: Record<string, DirectiveSummary[]> = {}
  if (!existsSync(root) || !statSync(root).isDirectory()) return out
  for (const status of readdirSync(root).sort()) {
    const statusPath = join(root, status)
    if (!statSync(statusPath).isDirectory()) continue
    const list: DirectiveSummary[] = []
    for (const filename of readdirSync(statusPath).sort()) {
      if (!filename.endsWith('.md')) continue
      const filepath = join(statusPath, filename)
      let content: string
      try {
        content = readFileSync(filepath, 'utf-8')
      } catch {
        continue
      }
      const { fm, body } = parseFrontmatter(content)
      if (!body.trim()) continue
      list.push({
        name: typeof fm.name === 'string' ? fm.name : filename.replace(/\.md$/, ''),
        enabled: fm.enabled !== false,
        required: fm.required === true,
        max_retries: typeof fm.max_retries === 'number' ? fm.max_retries : 0,
        depends_on: typeof fm.depends_on === 'string' ? fm.depends_on : null,
        source: sourceLabel,
        source_file: filepath,
      })
    }
    if (list.length) out[status] = list
  }
  return out
}

function loadAll(): Record<string, DirectiveSummary[]> {
  const committed = loadFromDir(join(PROJECT_ROOT, 'delegator', 'directives'), 'committed')
  const local = loadFromDir(join(PROJECT_ROOT, 'delegator', 'directives.local'), 'local')

  const statuses = new Set([...Object.keys(committed), ...Object.keys(local)])
  const out: Record<string, DirectiveSummary[]> = {}
  for (const status of statuses) {
    const merged = new Map<string, DirectiveSummary>()
    for (const d of committed[status] || []) merged.set(d.name, d)
    for (const d of local[status] || []) merged.set(d.name, d)
    out[status] = Array.from(merged.values())
  }
  return out
}

/** Shell out to the one command that owns directive runs, so the dashboard,
 *  the worker session, and a human at a terminal all take the same path. */
function control(
  args: string[],
  done: (err: Error | null, stdout: string, stderr: string) => void,
) {
  execFile(
    'python3',
    [CONTROL_SCRIPT, ...args],
    { timeout: 30000, env: { ...process.env, HOME: homedir() } },
    (err, stdout, stderr) => done(err, stdout, stderr),
  )
}

export function registerDirectiveRoutes(server: ViteDevServer) {
  // GET /api/directives/runs?item=<id> — live and finished runs for one item.
  server.middlewares.use('/api/directives/runs', (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url || '', 'http://localhost')
    const itemId = url.searchParams.get('item')
    if (!itemId) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'item query parameter is required' }))
      return
    }
    control(['list', itemId, '--json'], (err, stdout) => {
      if (err) {
        res.end(JSON.stringify({ runs: [] }))
        return
      }
      try {
        res.end(JSON.stringify(JSON.parse(stdout)))
      } catch {
        res.end(JSON.stringify({ runs: [] }))
      }
    })
  })

  // POST /api/directives/stop — stop one live run. Body: { itemId, directive, reason }
  server.middlewares.use('/api/directives/stop', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.itemId || !body.directive) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'itemId and directive are required' }))
        return
      }
      const reason = body.reason || 'stopped from the dashboard'
      control(['stop', body.itemId, body.directive, reason], (err, stdout, stderr) => {
        if (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: stderr || String(err) }))
          return
        }
        try {
          res.end(JSON.stringify(JSON.parse(stdout)))
        } catch {
          res.end(JSON.stringify({ ok: true, output: stdout }))
        }
      })
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // GET /api/directives/output?item=<id>&directive=<name>&lines=<n>
  server.middlewares.use('/api/directives/output', (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url || '', 'http://localhost')
    const itemId = url.searchParams.get('item')
    const directive = url.searchParams.get('directive')
    const lines = url.searchParams.get('lines') || '200'
    if (!itemId || !directive) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'item and directive query parameters are required' }))
      return
    }
    control(['tail', itemId, directive, lines], (err, stdout) => {
      if (err) {
        res.end(JSON.stringify({ output: '' }))
        return
      }
      res.end(JSON.stringify({ output: stdout }))
    })
  })

  server.middlewares.use('/api/directives', (req, res, next) => {
    if (req.url && req.url !== '/' && req.url !== '') {
      next()
      return
    }
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    try {
      res.end(JSON.stringify({ statuses: loadAll() }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}
