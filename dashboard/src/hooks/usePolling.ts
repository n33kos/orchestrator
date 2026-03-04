import { useEffect, useRef, useCallback } from 'react'

/**
 * Generic polling hook that calls a callback at a fixed interval
 * with automatic pause/resume support.
 *
 * @param callback - Function to call on each interval tick (and immediately on mount)
 * @param intervalMs - Polling interval in milliseconds
 * @param enabled - Whether polling is active (set false to pause)
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
) {
  const savedCallback = useRef(callback)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep the latest callback in a ref so we don't restart the interval
  // every time the callback identity changes.
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  const tick = useCallback(() => {
    savedCallback.current()
  }, [])

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Fire immediately on enable
    tick()

    intervalRef.current = setInterval(tick, intervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [tick, intervalMs, enabled])
}
