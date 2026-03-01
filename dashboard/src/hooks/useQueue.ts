import { useState, useEffect, useCallback } from 'react'
import type { WorkItem, QueueData } from '../types.ts'

export function useQueue() {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue')
      if (res.ok) {
        const data: QueueData = await res.json()
        setItems(data.items)
      }
    } catch {
      // API not available — use empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQueue()
  }, [fetchQueue])

  const activeItems = items.filter(i => i.status === 'active')
  const queuedItems = items.filter(i => i.status === 'queued' || i.status === 'planning')
  const pausedItems = items.filter(i => i.status === 'paused')
  const reviewItems = items.filter(i => i.status === 'review')
  const completedItems = items.filter(i => i.status === 'completed')

  return {
    items,
    activeItems,
    queuedItems,
    pausedItems,
    reviewItems,
    completedItems,
    loading,
    refresh: fetchQueue,
  }
}
