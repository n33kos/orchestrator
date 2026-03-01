import { useMemo } from 'react'
import type { HistoryEntry } from './useToast.ts'

const BUCKETS = 12 // 12 buckets
const BUCKET_MS = 5 * 60 * 1000 // 5 minutes each = 1 hour total

export function useActivitySparkline(history: HistoryEntry[]): number[] {
  return useMemo(() => {
    const now = Date.now()
    const data = new Array(BUCKETS).fill(0) as number[]

    for (const entry of history) {
      const age = now - new Date(entry.timestamp).getTime()
      if (age > BUCKETS * BUCKET_MS) continue
      const bucket = Math.floor(age / BUCKET_MS)
      if (bucket >= 0 && bucket < BUCKETS) {
        data[BUCKETS - 1 - bucket]++
      }
    }

    return data
  }, [history])
}
