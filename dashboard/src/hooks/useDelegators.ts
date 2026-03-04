import { useState, useEffect, useCallback } from 'react'

export interface DelegatorHealth {
  status: 'healthy' | 'stale' | 'error'
  last_successful_cycle_at: string | null
  consecutive_errors: number
  last_error: string | null
}

export interface DelegatorStatus {
  item_id: string
  worker_session_id: string
  worktree_path: string
  branch: string
  created_at: string
  cycle_count: number
  last_cycle_at: string | null
  cycle_running: boolean
  health: DelegatorHealth
  worker_state: Record<string, unknown>
  flags: Record<string, unknown>
  commits: Record<string, unknown>
  pr: Record<string, unknown>
  cycle_log: { timestamp: string; result: string; message?: string }[]
  lastCyclePayload: Record<string, unknown> | null
  lastTriageOutput: Record<string, unknown> | string | null
  // Legacy / derived fields kept for backward compat
  status: string
  commits_reviewed: number
  commit_reviews: { hash: string; message: string; assessment: string; timestamp: string }[]
  issues_found: { severity: string; description: string; file?: string; timestamp: string }[]
  stall_detected: boolean
  pr_reviewed: boolean
  assessment: string | null
  errors: string[]
}

export function useDelegators(pollInterval = 10_000) {
  const [delegators, setDelegators] = useState<DelegatorStatus[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    fetch('/api/delegators')
      .then(r => r.json())
      .then(data => {
        setDelegators(data.delegators || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, pollInterval)
    return () => clearInterval(interval)
  }, [refresh, pollInterval])

  const issueCount = delegators.reduce((sum, d) => sum + (d.issues_found?.length ?? 0), 0)
  const errorCount = delegators.filter(d => d.health?.status === 'error').length
  const staleCount = delegators.filter(d => d.health?.status === 'stale').length
  const healthyCount = delegators.filter(d => d.health?.status === 'healthy').length
  const stallCount = delegators.filter(d => d.stall_detected).length

  return {
    delegators,
    loading,
    refresh,
    count: delegators.length,
    healthyCount,
    staleCount,
    issueCount,
    errorCount,
    stallCount,
    alertCount: issueCount + errorCount + staleCount + stallCount,
  }
}
