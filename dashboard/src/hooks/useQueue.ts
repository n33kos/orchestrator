import { useState, useEffect, useCallback, useRef } from 'react'
import type { WorkItem, QueueData, WorkItemStatus } from '../types.ts'

function normalizeItem(raw: Record<string, unknown>): WorkItem {
  return {
    ...raw,
    blockers: Array.isArray(raw.blockers) ? raw.blockers as WorkItem['blockers'] : [],
    pr_url: (raw.pr_url as string) ?? null,
  } as WorkItem
}

export function useQueue(pollIntervalMs = 5000) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue')
      if (res.ok) {
        const data: QueueData = await res.json()
        setItems(data.items.map(i => normalizeItem(i as unknown as Record<string, unknown>)))
        setLastUpdated(new Date())
      }
    } catch {
      // API not available — use empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQueue()
    pollRef.current = setInterval(fetchQueue, pollIntervalMs)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchQueue, pollIntervalMs])

  const updateItem = useCallback(async (id: string, updates: { status?: WorkItemStatus; priority?: number; delegator_enabled?: boolean; title?: string; description?: string }) => {
    // Optimistic update: apply changes locally before API responds
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, ...updates }
      if (updates.status === 'active' && !item.activated_at) {
        updated.activated_at = new Date().toISOString()
      }
      if (updates.status === 'completed' && !item.completed_at) {
        updated.completed_at = new Date().toISOString()
      }
      return updated
    }))
    try {
      await fetch('/api/queue/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
      await fetchQueue()
    } catch {
      // Revert on failure by re-fetching
      await fetchQueue()
    }
  }, [fetchQueue])

  const reorderItems = useCallback(async (dragId: string, dropId: string) => {
    await fetch('/api/queue/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dragId, dropId }),
    })
    await fetchQueue()
  }, [fetchQueue])

  const addBlocker = useCallback(async (id: string, description: string) => {
    await fetch('/api/queue/blocker/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, description }),
    })
    await fetchQueue()
  }, [fetchQueue])

  const resolveBlocker = useCallback(async (id: string, blockerId: string, resolved = true) => {
    await fetch('/api/queue/blocker/resolve', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, blockerId, resolved }),
    })
    await fetchQueue()
  }, [fetchQueue])

  const deleteItem = useCallback(async (id: string) => {
    // Optimistic removal
    setItems(prev => prev.filter(item => item.id !== id))
    try {
      await fetch('/api/queue/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await fetchQueue()
    } catch {
      await fetchQueue()
    }
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
    lastUpdated,
    refresh: fetchQueue,
    updateItem,
    reorderItems,
    addBlocker,
    resolveBlocker,
    deleteItem,
  }
}
