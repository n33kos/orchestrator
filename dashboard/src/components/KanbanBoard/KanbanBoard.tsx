import { useState } from 'react'
import styles from './KanbanBoard.module.scss'
import classnames from 'classnames'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface Props {
  items: WorkItem[]
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onNavigate: (id: string) => void
}

const COLUMNS: { status: WorkItemStatus; label: string }[] = [
  { status: 'queued', label: 'Queued' },
  { status: 'active', label: 'Active' },
  { status: 'review', label: 'Review' },
  { status: 'completed', label: 'Completed' },
]

export function KanbanBoard({ items, onStatusChange, onNavigate }: Props) {
  const [dragItem, setDragItem] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<WorkItemStatus | null>(null)
  useTimeRefresh(60_000)

  function handleDragStart(id: string) {
    setDragItem(id)
  }

  function handleDragOver(e: React.DragEvent, status: WorkItemStatus) {
    e.preventDefault()
    setDragOverCol(status)
  }

  function handleDrop(status: WorkItemStatus) {
    if (dragItem) {
      const item = items.find(i => i.id === dragItem)
      if (item && item.status !== status) {
        onStatusChange(dragItem, status)
      }
    }
    setDragItem(null)
    setDragOverCol(null)
  }

  function handleDragEnd() {
    setDragItem(null)
    setDragOverCol(null)
  }

  // Group items, including paused items in the queued column
  const grouped: Record<string, WorkItem[]> = {}
  for (const col of COLUMNS) {
    if (col.status === 'queued') {
      grouped[col.status] = items.filter(i => i.status === 'queued' || i.status === 'planning' || i.status === 'paused')
    } else {
      grouped[col.status] = items.filter(i => i.status === col.status)
    }
  }

  return (
    <div className={styles.Root}>
      {COLUMNS.map(col => (
        <div
          key={col.status}
          className={classnames(styles.Column, dragOverCol === col.status && styles.ColumnDragOver)}
          onDragOver={e => handleDragOver(e, col.status)}
          onDrop={() => handleDrop(col.status)}
          onDragLeave={() => setDragOverCol(null)}
        >
          <div className={styles.ColumnHeader}>
            <StatusBadge status={col.status} />
            <span className={styles.ColumnCount}>{grouped[col.status].length}</span>
          </div>
          <div className={styles.ColumnBody}>
            {grouped[col.status].map(item => (
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
                  <span className={styles.CardType}>{item.type === 'project' ? 'P' : 'QF'}</span>
                  {item.branch && <code className={styles.CardBranch}>{item.branch}</code>}
                  <span className={styles.CardTime}>{timeAgo(item.activated_at || item.created_at)}</span>
                </div>
                {item.blockers.some(b => !b.resolved) && (
                  <span className={styles.CardBlocker}>
                    {item.blockers.filter(b => !b.resolved).length} blocker{item.blockers.filter(b => !b.resolved).length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ))}
            {grouped[col.status].length === 0 && (
              <div className={styles.EmptyCol}>No items</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
