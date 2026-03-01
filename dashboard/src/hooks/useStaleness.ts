import { useState, useEffect } from 'react'

interface StalenessInfo {
  isStale: boolean
  secondsSinceUpdate: number
}

/**
 * Returns whether the data is stale (no update for more than `staleAfterMs`).
 * Refreshes every second.
 */
export function useStaleness(lastUpdated: Date | null, staleAfterMs: number = 30_000): StalenessInfo {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!lastUpdated) {
    return { isStale: true, secondsSinceUpdate: Infinity }
  }

  const elapsed = now - lastUpdated.getTime()
  return {
    isStale: elapsed > staleAfterMs,
    secondsSinceUpdate: Math.floor(elapsed / 1000),
  }
}
