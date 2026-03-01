import { useRef, useCallback, useEffect } from 'react'

/**
 * Returns a debounced version of the callback.
 * Unlike useDebounce (which debounces a value), this debounces a function call.
 */
export function useDebounceCallback<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number,
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  return useCallback((...args: unknown[]) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => callbackRef.current(...args), delay)
  }, [delay]) as unknown as T
}
