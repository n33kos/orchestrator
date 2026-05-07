import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'

const PROJECT_ROOT = join(homedir(), 'orchestrator')

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

export function registerDirectiveRoutes(server: ViteDevServer) {
  server.middlewares.use('/api/directives', (req, res) => {
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
