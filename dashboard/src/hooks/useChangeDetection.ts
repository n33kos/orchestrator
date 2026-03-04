import { useRef, useMemo } from 'react'
import type { WorkItem } from '../types.ts'

export interface ItemChange {
  id: string
  field: string
  from: string
  to: string
}

/**
 * Detects changes in work items between renders.
 * Returns a map of item ID -> list of changes since last render.
 */
export function useChangeDetection(items: WorkItem[]): Map<string, ItemChange[]> {
  const prevRef = useRef<Map<string, WorkItem>>(new Map())

  return useMemo(() => {
    const changes = new Map<string, ItemChange[]>()
    const currentMap = new Map(items.map(i => [i.id, i]))

    for (const item of items) {
      const prev = prevRef.current.get(item.id)
      if (!prev) continue // new item, no diff

      const diffs: ItemChange[] = []
      if (prev.status !== item.status) {
        diffs.push({ id: item.id, field: 'status', from: prev.status, to: item.status })
      }
      if (prev.priority !== item.priority) {
        diffs.push({ id: item.id, field: 'priority', from: String(prev.priority), to: String(item.priority) })
      }
      if ((prev.pr_url || '') !== (item.pr_url || '')) {
        diffs.push({ id: item.id, field: 'pr_url', from: prev.pr_url || '', to: item.pr_url || '' })
      }
      if (prev.blocked_by.length !== item.blocked_by.length || prev.blocked_by.join(',') !== item.blocked_by.join(',')) {
        diffs.push({ id: item.id, field: 'blocked_by', from: prev.blocked_by.join(','), to: item.blocked_by.join(',') })
      }
      if (diffs.length > 0) {
        changes.set(item.id, diffs)
      }
    }

    prevRef.current = currentMap
    return changes
  }, [items])
}
