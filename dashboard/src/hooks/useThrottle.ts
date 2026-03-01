import { useRef, useCallback } from 'react'

/**
 * Returns a throttled version of the callback that fires at most once per `ms`.
 */
export function useThrottle<T extends (...args: unknown[]) => void>(
  callback: T,
  ms: number,
): T {
  const lastCallRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  return useCallback((...args: unknown[]) => {
    const now = Date.now()
    const remaining = ms - (now - lastCallRef.current)

    if (remaining <= 0) {
      lastCallRef.current = now
      callback(...args)
    } else {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        lastCallRef.current = Date.now()
        callback(...args)
      }, remaining)
    }
  }, [callback, ms]) as unknown as T
}
