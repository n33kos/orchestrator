import { useState, useEffect, useCallback } from 'react'
import type { WorkItem, QueueData } from '../types.ts'

function normalizeItem(raw: Record<string, unknown>): WorkItem {
  return {
    ...raw,
    blockers: Array.isArray(raw.blockers) ? raw.blockers as WorkItem['blockers'] : [],
  } as WorkItem
}

export function useQueue() {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue')
      if (res.ok) {
        const data: QueueData = await res.json()
        setItems(data.items.map(i => normalizeItem(i as unknown as Record<string, unknown>)))
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

  const projects = items.filter(i => i.type === 'project')
  const quickFixes = items.filter(i => i.type === 'quick_fix')
  const activeItems = items.filter(i => i.status === 'active')
  const queuedItems = items.filter(i => i.status === 'queued' || i.status === 'planning')
  const pausedItems = items.filter(i => i.status === 'paused')
  const reviewItems = items.filter(i => i.status === 'review')
  const completedItems = items.filter(i => i.status === 'completed')
  const blockedItems = items.filter(i => i.blockers.some(b => !b.resolved))

  return {
    items,
    projects,
    quickFixes,
    activeItems,
    queuedItems,
    pausedItems,
    reviewItems,
    completedItems,
    blockedItems,
    loading,
    refresh: fetchQueue,
  }
}
