import { useRef, useCallback, useEffect } from 'react'

type Listener<T> = (data: T) => void

/**
 * Simple event emitter for cross-component communication.
 * Returns emit and subscribe functions.
 */
export function useEventEmitter<T = unknown>() {
  const listenersRef = useRef<Set<Listener<T>>>(new Set())

  const emit = useCallback((data: T) => {
    for (const fn of listenersRef.current) {
      fn(data)
    }
  }, [])

  const subscribe = useCallback((fn: Listener<T>) => {
    listenersRef.current.add(fn)
    return () => { listenersRef.current.delete(fn) }
  }, [])

  return { emit, subscribe }
}

/**
 * Hook to subscribe to an event emitter, auto-cleaning on unmount.
 */
export function useEventListener<T>(
  subscribe: (fn: Listener<T>) => () => void,
  handler: Listener<T>,
) {
  useEffect(() => {
    return subscribe(handler)
  }, [subscribe, handler])
}
