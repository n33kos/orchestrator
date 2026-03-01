import { useEffect, useState, useCallback } from 'react'

/**
 * Like usePersistedState but also syncs across browser tabs
 * by listening to the `storage` event.
 */
export function useStorageSync<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const fullKey = `orchestrator:${key}`

  const [value, setValueState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(fullKey)
      return stored ? JSON.parse(stored) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setValueState(prev => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next
      try {
        localStorage.setItem(fullKey, JSON.stringify(resolved))
      } catch { /* quota exceeded */ }
      return resolved
    })
  }, [fullKey])

  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key !== fullKey) return
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : initialValue
        setValueState(parsed)
      } catch { /* ignore parse errors */ }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [fullKey, initialValue])

  return [value, setValue]
}
