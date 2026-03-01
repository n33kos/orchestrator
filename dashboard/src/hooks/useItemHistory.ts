import { useState, useCallback } from 'react'

interface HistoryEvent {
  id: string
  itemId: string
  field: string
  from: string
  to: string
  timestamp: string
}

const MAX_EVENTS = 200
const STORAGE_KEY = 'orchestrator:itemHistory'

function loadHistory(): HistoryEvent[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return []
}

function saveHistory(events: HistoryEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch { /* ignore */ }
}

export function useItemHistory() {
  const [events, setEvents] = useState<HistoryEvent[]>(loadHistory)

  const record = useCallback((itemId: string, field: string, from: string, to: string) => {
    const event: HistoryEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      itemId,
      field,
      from,
      to,
      timestamp: new Date().toISOString(),
    }
    setEvents(prev => {
      const next = [event, ...prev].slice(0, MAX_EVENTS)
      saveHistory(next)
      return next
    })
  }, [])

  const getItemEvents = useCallback((itemId: string) => {
    return events.filter(e => e.itemId === itemId)
  }, [events])

  const clearHistory = useCallback(() => {
    setEvents([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return {
    events,
    record,
    getItemEvents,
    clearHistory,
  }
}
