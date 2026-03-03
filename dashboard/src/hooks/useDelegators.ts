import { useState, useEffect, useCallback } from 'react'

export interface DelegatorStatus {
  status: string
  item_id: string
  worker_session: string
  worktree_path: string
  branch: string
  started_at: string
  last_check: string | null
  last_seen_commit: string | null
  commits_reviewed: number
  commit_reviews: { hash: string; message: string; assessment: string; timestamp: string }[]
  issues_found: { severity: string; description: string; file?: string; timestamp: string }[]
  stall_detected: boolean
  pr_reviewed: boolean
  assessment: string | null
  errors: string[]
  session_alive: boolean
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
  const errorCount = delegators.reduce((sum, d) => sum + (d.errors?.length ?? 0), 0)
  const stallCount = delegators.filter(d => d.stall_detected).length

  return {
    delegators,
    loading,
    refresh,
    count: delegators.length,
    issueCount,
    errorCount,
    stallCount,
    alertCount: issueCount + errorCount + stallCount,
  }
}
