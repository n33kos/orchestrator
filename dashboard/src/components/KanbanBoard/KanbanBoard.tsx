import { useState } from 'react'
import styles from './KanbanBoard.module.scss'
import classnames from 'classnames'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'
import type { SortField, SortDirection } from '../SortControls/SortControls.tsx'

interface Props {
  items: WorkItem[]
  sortField?: SortField
  sortDirection?: SortDirection
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onNavigate: (id: string) => void
}

type ColumnKey = WorkItemStatus | 'plan_review'

interface ColumnDef {
  key: ColumnKey
  /** The status used for StatusBadge rendering and drag-drop transitions */
  status: WorkItemStatus
  label: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'plan_review', status: 'planning', label: 'Plan Review' },
  { key: 'queued', status: 'queued', label: 'Queued' },
  { key: 'active', status: 'active', label: 'Active' },
  { key: 'review', status: 'review', label: 'Review' },
  { key: 'completed', status: 'completed', label: 'Completed' },
]

function sortItems(items: WorkItem[], field: SortField, direction: SortDirection): WorkItem[] {
  const dir = direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    switch (field) {
      case 'priority':
        return (a.priority - b.priority) * dir
      case 'created': {
        const da = new Date(a.created_at).getTime()
        const db = new Date(b.created_at).getTime()
        return (da - db) * dir
      }
      case 'title':
        return a.title.localeCompare(b.title) * dir
      case 'status':
      default:
        return (a.priority - b.priority) * dir
    }
  })
}

export function KanbanBoard({ items, sortField = 'priority', sortDirection = 'asc', onStatusChange, onNavigate }: Props) {
  const [dragItem, setDragItem] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ColumnKey | null>(null)
  useTimeRefresh(60_000)

  function handleDragStart(id: string) {
    setDragItem(id)
  }

  function handleDragOver(e: React.DragEvent, colKey: ColumnKey) {
    e.preventDefault()
    setDragOverCol(colKey)
  }

  function handleDrop(col: ColumnDef) {
    if (dragItem) {
      const item = items.find(i => i.id === dragItem)
      if (item && item.status !== col.status) {
        onStatusChange(dragItem, col.status)
      }
    }
    setDragItem(null)
    setDragOverCol(null)
  }

  function handleDragEnd() {
    setDragItem(null)
    setDragOverCol(null)
  }

  // Group items into columns
  const grouped: Record<ColumnKey, WorkItem[]> = {
    plan_review: [],
    queued: [],
    active: [],
    review: [],
    completed: [],
  }

  for (const item of items) {
    if (item.status === 'planning' && (item.metadata.plan as Record<string, unknown>)?.approved !== true) {
      grouped.plan_review.push(item)
    } else if (item.status === 'queued' || item.status === 'paused' || (item.status === 'planning' && (item.metadata.plan as Record<string, unknown>)?.approved === true)) {
      grouped.queued.push(item)
    } else if (item.status in grouped) {
      grouped[item.status as ColumnKey].push(item)
    }
  }

  // Sort items within each column
  for (const key of Object.keys(grouped) as ColumnKey[]) {
    grouped[key] = sortItems(grouped[key], sortField, sortDirection)
  }

  return (
    <div className={styles.Root}>
      {COLUMNS.map(col => (
        <div
          key={col.key}
          className={classnames(styles.Column, dragOverCol === col.key && styles.ColumnDragOver)}
          onDragOver={e => handleDragOver(e, col.key)}
          onDrop={() => handleDrop(col)}
          onDragLeave={() => setDragOverCol(null)}
        >
          <div className={styles.ColumnHeader}>
            <StatusBadge status={col.status} />
            {col.key !== col.status && <span className={styles.ColumnLabel}>{col.label}</span>}
            <span className={styles.ColumnCount}>{grouped[col.key].length}</span>
          </div>
          <div className={styles.ColumnBody}>
            {grouped[col.key].map(item => (
              <div
                key={item.id}
                className={classnames(styles.Card, dragItem === item.id && styles.CardDragging)}
                draggable
                onDragStart={() => handleDragStart(item.id)}
                onDragEnd={handleDragEnd}
                onClick={() => onNavigate(item.id)}
              >
                <div className={styles.CardHeader}>
                  <span className={styles.CardTitle}>{item.title}</span>
                  <PriorityBadge priority={item.priority} />
                </div>
                <div className={styles.CardMeta}>
                  <span className={styles.CardType}>{item.id.toUpperCase()}</span>
                  <span className={styles.CardType}>{item.type === 'project' ? 'P' : 'QF'}</span>
                  {item.branch && <code className={styles.CardBranch}>{item.branch}</code>}
                  <span className={styles.CardTime}>{timeAgo(item.activated_at || item.created_at)}</span>
                </div>
                {(item.blocked_by || []).length > 0 && (
                  <span className={styles.CardDep}>
                    Blocked by {(item.blocked_by || []).join(', ')}
                  </span>
                )}
              </div>
            ))}
            {grouped[col.key].length === 0 && (
              <div className={styles.EmptyCol}>No items</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
