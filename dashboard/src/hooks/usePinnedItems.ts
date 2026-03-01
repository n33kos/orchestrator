import { useState, useCallback } from 'react'

const STORAGE_KEY = 'orchestrator:pinnedItems'

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

function savePinned(set: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
}

export function usePinnedItems() {
  const [pinned, setPinned] = useState<Set<string>>(loadPinned)

  const togglePin = useCallback((id: string) => {
    setPinned(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      savePinned(next)
      return next
    })
  }, [])

  const isPinned = useCallback((id: string) => pinned.has(id), [pinned])

  return { pinned, togglePin, isPinned }
}
