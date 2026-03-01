import { useState, useCallback } from 'react'

const STORAGE_PREFIX = 'orchestrator:'

export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `${STORAGE_PREFIX}${key}`

  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored !== null) {
        return JSON.parse(stored) as T
      }
    } catch {
      // Ignore parse errors, fall through to default
    }
    return defaultValue
  })

  const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
    setState(prev => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // Ignore storage quota errors
      }
      return next
    })
  }, [storageKey])

  return [state, setPersistedState]
}
