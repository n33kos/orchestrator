import { useState, useEffect, useCallback } from 'react'

export interface PrStatus {
  state: 'OPEN' | 'CLOSED' | 'MERGED' | 'unknown'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable: string | null
  title: string
  additions: number
  deletions: number
  changedFiles: number
  reviews: { state: string; author: string }[]
  checksPass: boolean
  checksFail: boolean
  checksPending: boolean
  checksTotal: number
  createdAt: string
  updatedAt: string
  url: string
  error?: string
}

const cache = new Map<string, { data: PrStatus; fetchedAt: number }>()
const CACHE_TTL = 120_000 // 2 minutes

export function usePrStatus(prUrl: string | null) {
  const [status, setStatus] = useState<PrStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!prUrl) { setStatus(null); return }

    // Check cache
    const cached = cache.get(prUrl)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      setStatus(cached.data)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/pr-status?url=${encodeURIComponent(prUrl)}`)
      if (res.ok) {
        const data: PrStatus = await res.json()
        cache.set(prUrl, { data, fetchedAt: Date.now() })
        setStatus(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [prUrl])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  return { status, loading, refresh: fetchStatus }
}
