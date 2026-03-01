import styles from './WorkStreamList.module.scss'
import { WorkStreamCard } from '../WorkStreamCard/WorkStreamCard.tsx'
import { useDragReorder } from '../../hooks/useDragReorder.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'
import type { SortField, SortDirection } from '../SortControls/SortControls.tsx'

interface WorkStreamListProps {
  items: WorkItem[]
  loading: boolean
  hasSearch: boolean
  emptyLabel?: string
  sortField: SortField
  sortDirection: SortDirection
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onPriorityChange: (id: string, priority: number) => void
  onDelegatorToggle: (id: string, enabled: boolean) => void
  onEdit: (id: string, updates: { title?: string; description?: string }) => void
  onAddBlocker: (id: string, description: string) => void
  onResolveBlocker: (id: string, blockerId: string) => void
  onUnresolveBlocker: (id: string, blockerId: string) => void
  onDelete: (id: string) => void
  onReorder: (dragId: string, dropId: string) => void
}

export function WorkStreamList({ items, loading, hasSearch, emptyLabel, sortField, sortDirection, onStatusChange, onPriorityChange, onDelegatorToggle, onEdit, onAddBlocker, onResolveBlocker, onUnresolveBlocker, onDelete, onReorder }: WorkStreamListProps) {
  const { dragId, overId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } = useDragReorder(onReorder)
  if (loading) {
    return (
      <div className={styles.Root}>
        <div className={styles.Empty}>
          <div className={styles.Spinner} />
          <p className={styles.EmptyText}>Loading work streams...</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={styles.Root}>
        <div className={styles.Empty}>
          <div className={styles.EmptyIcon}>
            {hasSearch ? (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            ) : (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
            )}
          </div>
          <p className={styles.EmptyText}>
            {hasSearch ? 'No matching work streams' : (emptyLabel || 'No work streams')}
          </p>
          <p className={styles.EmptySubtext}>
            {hasSearch
              ? 'Try adjusting your search query or clearing the filter.'
              : 'Add work items manually or configure sources to discover them automatically.'}
          </p>
        </div>
      </div>
    )
  }

  const statusOrder: Record<string, number> = {
    active: 0,
    review: 1,
    queued: 2,
    planning: 3,
    paused: 4,
    completed: 5,
  }

  const dir = sortDirection === 'asc' ? 1 : -1

  const sorted = [...items].sort((a, b) => {
    switch (sortField) {
      case 'status': {
        const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        if (statusDiff !== 0) return statusDiff * dir
        return (a.priority - b.priority) * dir
      }
      case 'created': {
        const da = new Date(a.created_at).getTime()
        const db = new Date(b.created_at).getTime()
        return (da - db) * dir
      }
      case 'title':
        return a.title.localeCompare(b.title) * dir
      case 'priority':
      default: {
        const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        if (statusDiff !== 0) return statusDiff
        return (a.priority - b.priority) * dir
      }
    }
  })

  return (
    <div className={styles.Root}>
      {sorted.map(item => (
        <WorkStreamCard
          key={item.id}
          item={item}
          isDragging={dragId === item.id}
          isDragOver={overId === item.id}
          onStatusChange={onStatusChange}
          onPriorityChange={onPriorityChange}
          onDelegatorToggle={onDelegatorToggle}
          onEdit={onEdit}
          onAddBlocker={onAddBlocker}
          onResolveBlocker={onResolveBlocker}
          onUnresolveBlocker={onUnresolveBlocker}
          onDelete={onDelete}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  )
}
