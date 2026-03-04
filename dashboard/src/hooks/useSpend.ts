import { useState, useCallback, useEffect } from 'react'

interface SpendTotals {
  today: number
  week: number
  month: number
  all_time: number
}

interface SpendData {
  /** Orchestrator-managed item spend totals (from queue metadata) */
  orchestrator: SpendTotals
  /** Total user spend across all Claude usage (from ccusage) */
  overall: SpendTotals | null
  loading: boolean
  /** Trigger a fresh fetch (calls /api/spend which runs ccusage — slow) */
  refresh: () => void
}

const EMPTY_TOTALS: SpendTotals = { today: 0, week: 0, month: 0, all_time: 0 }

export function useSpend(): SpendData {
  const [orchestrator, setOrchestrator] = useState<SpendTotals>(EMPTY_TOTALS)
  const [overall, setOverall] = useState<SpendTotals | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, load cached data for instant display
  useEffect(() => {
    fetch('/api/spend/cached')
      .then(res => {
        if (res.status === 204) return null
        return res.json()
      })
      .then(data => {
        if (data) {
          setOrchestrator(data.totals ?? EMPTY_TOTALS)
          setOverall(data.overall ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Refresh: calls the full /api/spend endpoint (runs ccusage — ~30s)
  const refresh = useCallback(() => {
    setLoading(true)
    fetch('/api/spend')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setOrchestrator(data.totals ?? EMPTY_TOTALS)
          setOverall(data.overall ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return { orchestrator, overall, loading, refresh }
}
