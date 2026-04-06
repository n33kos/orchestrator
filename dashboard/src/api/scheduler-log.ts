import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'

const SCHEDULER_LOG_PATH = join(homedir(), '.claude/orchestrator/logs/orchestrator-scheduler.log')

export function registerSchedulerLogRoutes(server: ViteDevServer) {
  // GET /api/scheduler-log — read the last N lines of the scheduler log
  server.middlewares.use('/api/scheduler-log', (req, res) => {
    const url = new URL(req.url || '', 'http://localhost')
    const lines = parseInt(url.searchParams.get('lines') || '200', 10)

    res.setHeader('Content-Type', 'application/json')

    if (!existsSync(SCHEDULER_LOG_PATH)) {
      res.end(JSON.stringify({ lines: [], path: SCHEDULER_LOG_PATH, exists: false }))
      return
    }

    try {
      const content = readFileSync(SCHEDULER_LOG_PATH, 'utf-8')
      const allLines = content.split('\n')
      const tail = allLines.slice(-lines).filter(l => l.length > 0)
      res.end(JSON.stringify({ lines: tail, path: SCHEDULER_LOG_PATH, exists: true }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err), lines: [], path: SCHEDULER_LOG_PATH }))
    }
  })
}
