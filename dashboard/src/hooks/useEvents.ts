import { useState, useEffect, useCallback, useRef } from 'react'

export interface OrchestratorEvent {
  timestamp: string
  type: string
  message: string
  severity: 'info' | 'warn' | 'error'
  item_id?: string
  session_id?: string
  extra?: string
}

export function useEvents(pollInterval = 15_000) {
  const [events, setEvents] = useState<OrchestratorEvent[]>([])
  const lastTimestamp = useRef('')

  const refresh = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' })
    if (lastTimestamp.current) {
      params.set('since', lastTimestamp.current)
    }
    fetch(`/api/events?${params}`)
      .then(r => r.json())
      .then(data => {
        const newEvents: OrchestratorEvent[] = data.events || []
        if (newEvents.length > 0) {
          lastTimestamp.current = newEvents[newEvents.length - 1].timestamp
          setEvents(prev => {
            // Deduplicate by timestamp+type
            const existing = new Set(prev.map(e => `${e.timestamp}:${e.type}`))
            const unique = newEvents.filter(e => !existing.has(`${e.timestamp}:${e.type}`))
            // Keep last 200 events
            return [...prev, ...unique].slice(-200)
          })
        }
      })
      .catch(() => { /* silently ignore */ })
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, pollInterval)
    return () => clearInterval(interval)
  }, [refresh, pollInterval])

  const unreadCount = events.filter(e => e.severity === 'error' || e.severity === 'warn').length

  return { events, unreadCount, refresh }
}
