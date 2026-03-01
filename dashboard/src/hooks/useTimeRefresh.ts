import { useState, useEffect } from 'react'

/**
 * Returns a timestamp that updates every `intervalMs` milliseconds.
 * Use this as a dependency in useMemo to force re-computation of relative times.
 */
export function useTimeRefresh(intervalMs = 60_000): number {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return tick
}
