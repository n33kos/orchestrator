import { useState, useEffect, useCallback, useRef } from 'react'
import type { SessionInfo } from '../types.ts'
import type { DelegatorStatus } from './useDelegators.ts'

interface HealthData {
  sessions?: { total: number; healthy: number; zombie: number; zombie_list?: string[] }
  queue?: { active_count: number; max_concurrent: number; stalled?: string[]; blocked?: string[] }
  issues?: { type: string; message: string; item_id?: string; session_id?: string }[]
}

interface QueueData {
  version: number
  items: Record<string, unknown>[]
}

export interface SystemStatus {
  queue: QueueData
  sessions: SessionInfo[]
  delegators: DelegatorStatus[]
  health: HealthData
  timestamp: string
}

/**
 * Combined system status hook — fetches everything in one request.
 * Use this for external clients (voice relay, CLI) or when you need
 * a consistent snapshot. The dashboard uses individual hooks for
 * independent polling intervals, but this hook is available as an
 * alternative for simpler use cases.
 */
export function useStatus(pollInterval = 30_000) {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (mountedRef.current) {
        setStatus(data)
        setError(null)
        setLoading(false)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(String(err))
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    refresh()
    const interval = setInterval(refresh, pollInterval)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [refresh, pollInterval])

  return { status, loading, error, refresh }
}
