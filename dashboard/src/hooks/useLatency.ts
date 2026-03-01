import { useState, useEffect, useRef } from 'react'

/**
 * Measures round-trip latency to the API server.
 * Pings every `intervalMs` and returns the latest latency in milliseconds.
 */
export function useLatency(endpoint = '/api/health', intervalMs = 30000) {
  const [latency, setLatency] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    async function measure() {
      const start = performance.now()
      try {
        await fetch(endpoint, { method: 'HEAD', cache: 'no-store' })
        setLatency(Math.round(performance.now() - start))
      } catch {
        setLatency(null)
      }
    }

    measure()
    timerRef.current = setInterval(measure, intervalMs)
    return () => clearInterval(timerRef.current)
  }, [endpoint, intervalMs])

  return latency
}
