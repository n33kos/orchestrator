import { useState, useCallback } from 'react'

const STORAGE_KEY = 'orchestrator:searchHistory'
const MAX_HISTORY = 8

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function save(items: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(load)

  const addSearch = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) return
    setHistory(prev => {
      const next = [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, MAX_HISTORY)
      save(next)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const removeItem = useCallback((query: string) => {
    setHistory(prev => {
      const next = prev.filter(s => s !== query)
      save(next)
      return next
    })
  }, [])

  return { history, addSearch, clearHistory, removeItem }
}
