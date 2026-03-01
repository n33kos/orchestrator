import { useState, useCallback, useRef } from 'react'

interface AsyncActionState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Wraps an async function with loading/error state management.
 * Prevents duplicate invocations while loading.
 */
export function useAsyncAction<T, A extends unknown[]>(
  action: (...args: A) => Promise<T>,
) {
  const [state, setState] = useState<AsyncActionState<T>>({
    data: null,
    loading: false,
    error: null,
  })
  const activeRef = useRef(false)

  const execute = useCallback(async (...args: A): Promise<T | null> => {
    if (activeRef.current) return null
    activeRef.current = true
    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const result = await action(...args)
      setState({ data: result, loading: false, error: null })
      activeRef.current = false
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setState(prev => ({ ...prev, loading: false, error: message }))
      activeRef.current = false
      return null
    }
  }, [action])

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null })
    activeRef.current = false
  }, [])

  return { ...state, execute, reset }
}
