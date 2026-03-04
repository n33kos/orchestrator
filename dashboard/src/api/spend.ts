import type { ViteDevServer } from 'vite'
import { readQueue } from './helpers'

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

export function registerSpendRoutes(server: ViteDevServer) {
  server.middlewares.use('/api/spend', (_req, res, next) => {
    if (_req.url && _req.url !== '/' && _req.url !== '') { next(); return }

    try {
      const queue = readQueue()
      const now = new Date()
      const todayStart = startOfDay(now)
      const weekStart = startOfWeek(now)
      const monthStart = startOfMonth(now)

      const items: SpendItem[] = []
      const totals: SpendTotals = { today: 0, week: 0, month: 0, all_time: 0 }

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

          totals.all_time += spendUsd

          // Bucket by activation date (or completed_at for finished items)
          const refDate = item.activated_at || item.completed_at || item.created_at
          if (refDate) {
            const d = new Date(refDate)
            if (d >= todayStart) totals.today += spendUsd
            if (d >= weekStart) totals.week += spendUsd
            if (d >= monthStart) totals.month += spendUsd
          }
        }
      }

      // Round totals
      totals.today = Math.round(totals.today * 100) / 100
      totals.week = Math.round(totals.week * 100) / 100
      totals.month = Math.round(totals.month * 100) / 100
      totals.all_time = Math.round(totals.all_time * 100) / 100

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ items, totals }))
    } catch (err) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}
