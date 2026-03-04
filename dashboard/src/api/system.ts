import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { ViteDevServer } from 'vite'
import { readBody, readQueue, writeQueue, queuePath, readConfigWithLocal, writeLocalConfig, getLocalConfigPath } from './helpers'

export function registerSystemRoutes(server: ViteDevServer) {
  // GET /api/health — orchestrator health check
  server.middlewares.use('/api/health', (_req, res, next) => {
    if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }
    const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'health-check.sh')
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
    const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'health-check.sh')
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
      const sourcesPath = join(__dirname, '..', '..', '..', 'config', 'sources.yml')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'discover-work.py')
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

  // POST /api/scheduler/cleanup — archive old completed items
  server.middlewares.use('/api/scheduler/cleanup', async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
    try {
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'scheduler.sh')
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
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'scheduler.sh')
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
        const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')
        writeLocalConfig(configPath, /^(\s*auto_activate:\s*).+$/m, '  auto_activate: false')
        res.end(JSON.stringify({ paused: true, message: 'Orchestration paused. Auto-activate disabled.' }))
      } else {
        // Remove pause file
        if (existsSync(pauseFilePath)) unlinkSync(pauseFilePath)
        // Update auto_activate to true in local config override
        const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')
        writeLocalConfig(configPath, /^(\s*auto_activate:\s*).+$/m, '  auto_activate: true')
        res.end(JSON.stringify({ paused: false, message: 'Orchestration resumed. Auto-activate enabled.' }))
      }
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  // GET/PATCH /api/config — read or update environment.yml settings
  server.middlewares.use('/api/config', async (req, res) => {
    if (req.method === 'PATCH') {
      try {
        const body = JSON.parse(await readBody(req))
        const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')

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
          schedulerPollInterval: { key: 'poll_interval', section: 'scheduler' },
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
      const configPath = join(__dirname, '..', '..', '..', 'config', 'environment.yml')
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
        schedulerPollInterval: parseInt(getVal('poll_interval')?.replace(/#.*/, '') || '120', 10),
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
    const scriptDir = join(__dirname, '..', '..', '..', 'scripts')
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
}
