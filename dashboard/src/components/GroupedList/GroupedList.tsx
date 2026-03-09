import { useMemo, useState } from 'react'
import styles from './GroupedList.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface GroupedListProps {
  items: WorkItem[]
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onNavigate: (id: string) => void
}

const STATUS_ORDER: WorkItemStatus[] = ['active', 'review', 'queued', 'planning', 'completed']
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  review: 'In Review',
  queued: 'Queued',
  planning: 'Planning',
  completed: 'Completed',
}

function getQuickAction(status: WorkItemStatus): { label: string; nextStatus: WorkItemStatus } | null {
  if (status === 'queued' || status === 'planning') return { label: 'Activate', nextStatus: 'active' }
  if (status === 'active') return { label: 'Review', nextStatus: 'review' }
  if (status === 'review') return { label: 'Complete', nextStatus: 'completed' }
  return null
}

export function GroupedList({ items, onStatusChange, onNavigate }: GroupedListProps) {
  useTimeRefresh(60_000)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const map = new Map<WorkItemStatus, WorkItem[]>()
    for (const item of items) {
      const list = map.get(item.status) || []
      list.push(item)
      map.set(item.status, list)
    }
    return STATUS_ORDER
      .filter(s => map.has(s))
      .map(status => ({ status, items: map.get(status)! }))
  }, [items])

  function toggleCollapse(status: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  if (items.length === 0) {
    return (
      <div className={styles.Empty}>
        <p className={styles.EmptyText}>No matching items</p>
      </div>
    )
  }

  return (
    <div className={styles.Root}>
      {groups.map(group => {
        const isCollapsed = collapsed.has(group.status)
        return (
          <div key={group.status} className={styles.Group}>
            <button className={styles.GroupHeader} onClick={() => toggleCollapse(group.status)}>
              <span className={`${styles.GroupChevron} ${isCollapsed ? '' : styles.GroupChevronOpen}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
              <StatusBadge status={group.status} />
              <span className={styles.GroupLabel}>{STATUS_LABELS[group.status] || group.status}</span>
              <span className={styles.GroupCount}>{group.items.length}</span>
            </button>
            {!isCollapsed && (
              <div className={styles.GroupItems}>
                {group.items.map(item => {
                  const action = getQuickAction(item.status)
                  return (
                    <div key={item.id} className={styles.Row} onClick={() => onNavigate(item.id)}>
                      <span className={styles.ColPriority}>
                        <PriorityBadge priority={item.priority} />
                      </span>
                      <span className={styles.ColTitle}>{item.title}</span>
                      <span className={styles.ColBranch}>
                        <code>{item.environment?.branch || '--'}</code>
                      </span>
                      <span className={styles.ColTime}>{timeAgo(item.activated_at || item.created_at)}</span>
                      <span className={styles.ColAction} onClick={e => e.stopPropagation()}>
                        {action && (
                          <button
                            className={styles.QuickAction}
                            onClick={() => onStatusChange(item.id, action.nextStatus)}
                          >
                            {action.label}
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
