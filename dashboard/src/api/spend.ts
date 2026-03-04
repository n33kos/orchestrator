import type { ViteDevServer } from 'vite'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { readQueue } from './helpers'

const CACHE_PATH = process.env.HOME + '/.claude/orchestrator/cache/spend.json'

interface SpendItem {
  id: string
  title: string
  status: string
  spend_usd: number
  activated_at: string | null
  completed_at: string | null
}

interface SpendTotals {
  today: number
  week: number
  month: number
  all_time: number
}

interface CcusageDailyEntry {
  date: string
  totalCost: number
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), diff))
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function fetchCcusageTotals(): { totals: SpendTotals; totalCost: number } | null {
  try {
    const output = execSync('npx ccusage --json --offline', {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, HOME: process.env.HOME || '' },
    })
    // ccusage returns { daily: [{date, totalCost, ...}], totals: {totalCost, ...} }
    const data = JSON.parse(output)
    const dailyEntries: CcusageDailyEntry[] = data.daily || []
    const allTimeCost: number = data.totals?.totalCost ?? 0

    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const weekStart = startOfWeek(now)
    const monthStart = startOfMonth(now)

    const totals: SpendTotals = { today: 0, week: 0, month: 0, all_time: allTimeCost }

    for (const entry of dailyEntries) {
      const cost = entry.totalCost ?? 0
      if (cost <= 0) continue
      const entryDate = new Date(entry.date + 'T00:00:00')
      if (entry.date === todayStr) totals.today += cost
      if (entryDate >= weekStart) totals.week += cost
      if (entryDate >= monthStart) totals.month += cost
    }

    totals.today = Math.round(totals.today * 100) / 100
    totals.week = Math.round(totals.week * 100) / 100
    totals.month = Math.round(totals.month * 100) / 100
    totals.all_time = Math.round(totals.all_time * 100) / 100

    return { totals, totalCost: allTimeCost }
  } catch (err) {
    console.error('[spend] ccusage failed:', err)
    return null
  }
}

function readCache(): object | null {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function writeCache(data: object): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(data))
  } catch { /* ignore cache write errors */ }
}

export function registerSpendRoutes(server: ViteDevServer) {
  // Cached endpoint — returns last known values instantly (no ccusage call)
  server.middlewares.use('/api/spend/cached', (_req, res, next) => {
    if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }
    const cached = readCache()
    res.setHeader('Content-Type', 'application/json')
    if (cached) {
      res.end(JSON.stringify(cached))
    } else {
      res.statusCode = 204
      res.end()
    }
  })

  server.middlewares.use('/api/spend', (_req, res, next) => {
    if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }

    try {
      const queue = readQueue()
      const now = new Date()
      const todayStart = startOfDay(now)
      const weekStart = startOfWeek(now)
      const monthStart = startOfMonth(now)

      const items: SpendItem[] = []
      const orchestratorTotals: SpendTotals = { today: 0, week: 0, month: 0, all_time: 0 }

      for (const item of queue.items || []) {
        const spend = item.metadata?.spend as { total_usd?: number } | undefined
        const spendUsd = spend?.total_usd ?? 0

        if (spendUsd > 0) {
          items.push({
            id: item.id,
            title: item.title,
            status: item.status,
            spend_usd: spendUsd,
            activated_at: item.activated_at,
            completed_at: item.completed_at,
          })

          orchestratorTotals.all_time += spendUsd

          // Bucket by activation date (or completed_at for finished items)
          const refDate = item.activated_at || item.completed_at || item.created_at
          if (refDate) {
            const d = new Date(refDate)
            if (d >= todayStart) orchestratorTotals.today += spendUsd
            if (d >= weekStart) orchestratorTotals.week += spendUsd
            if (d >= monthStart) orchestratorTotals.month += spendUsd
          }
        }
      }

      // Round orchestrator totals
      orchestratorTotals.today = Math.round(orchestratorTotals.today * 100) / 100
      orchestratorTotals.week = Math.round(orchestratorTotals.week * 100) / 100
      orchestratorTotals.month = Math.round(orchestratorTotals.month * 100) / 100
      orchestratorTotals.all_time = Math.round(orchestratorTotals.all_time * 100) / 100

      // Fetch total user spend from ccusage
      const ccusage = fetchCcusageTotals()

      const payload = {
        items,
        totals: orchestratorTotals,
        overall: ccusage?.totals ?? null,
        overall_total_cost: ccusage?.totalCost ?? null,
      }
      writeCache(payload)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(payload))
    } catch (err) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}
