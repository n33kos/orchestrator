import { useState, useEffect, useCallback, useRef } from 'react'
import type { WorkItem, QueueData, WorkItemStatus } from '../types.ts'

function normalizeItem(raw: Record<string, unknown>): WorkItem {
  return {
    ...raw,
    blocked_by: Array.isArray(raw.blocked_by) ? raw.blocked_by as string[] : [],
    pr_url: (raw.pr_url as string) ?? null,
  } as WorkItem
}

export function useQueue(pollIntervalMs = 5000) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchQueue = useCallback(async () => {
    const start = performance.now()
    try {
      const res = await fetch('/api/queue')
      if (res.ok) {
        const data: QueueData = await res.json()
        setItems(data.items.map(i => normalizeItem(i as unknown as Record<string, unknown>)))
        setLastUpdated(new Date())
        setLatencyMs(Math.round(performance.now() - start))
      }
    } catch {
      // API not available — use empty state
      setLatencyMs(null)
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

  const updateItem = useCallback(async (id: string, updates: { status?: WorkItemStatus; priority?: number; delegator_enabled?: boolean; title?: string; description?: string; pr_url?: string | null; branch?: string }) => {
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
    // Optimistic: reorder locally using the same visual sort logic
    const statusOrder: Record<string, number> = { active: 0, review: 1, queued: 2, planning: 3, paused: 4, completed: 5 }
    setItems(prev => {
      const sorted = [...prev].sort((a, b) => {
        const sd = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        if (sd !== 0) return sd
        return a.priority - b.priority
      })
      const dragIdx = sorted.findIndex(i => i.id === dragId)
      const dropIdx = sorted.findIndex(i => i.id === dropId)
      if (dragIdx === -1 || dropIdx === -1) return prev
      const [dragItem] = sorted.splice(dragIdx, 1)
      sorted.splice(dropIdx > dragIdx ? dropIdx : dropIdx, 0, dragItem)
      return sorted.map((item, i) => ({ ...item, priority: i + 1 }))
    })
    try {
      await fetch('/api/queue/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dragId, dropId }),
      })
      await fetchQueue()
    } catch {
      await fetchQueue()
    }
  }, [fetchQueue])

  const updateBlockedBy = useCallback(async (id: string, blocked_by: string[]) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, blocked_by } : item))
    try {
      await fetch('/api/queue/blocked-by/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, blocked_by }),
      })
      await fetchQueue()
    } catch {
      await fetchQueue()
    }
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

  const activeItems = items.filter(i => i.status === 'active')
  const queuedItems = items.filter(i => i.status === 'queued')
  const planningItems = items.filter(i => i.status === 'planning')
  const pausedItems = items.filter(i => i.status === 'paused')
  const reviewItems = items.filter(i => i.status === 'review')
  const completedItems = items.filter(i => i.status === 'completed')
  const blockedItems = items.filter(i => (i.blocked_by || []).length > 0 && (i.blocked_by || []).some(depId => {
    const dep = items.find(d => d.id === depId)
    return !dep || dep.status !== 'completed'
  }))

  return {
    items,
    activeItems,
    queuedItems,
    planningItems,
    pausedItems,
    reviewItems,
    completedItems,
    blockedItems,
    loading,
    lastUpdated,
    latencyMs,
    refresh: fetchQueue,
    updateItem,
    reorderItems,
    updateBlockedBy,
    deleteItem,
  }
}
