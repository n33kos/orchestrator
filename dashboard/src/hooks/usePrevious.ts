import { useRef, useEffect } from 'react'

/**
 * Returns the value from the previous render.
 * Useful for comparing current vs previous values.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>()

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref.current
}
