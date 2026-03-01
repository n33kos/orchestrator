import classnames from 'classnames'
import styles from './CompactList.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface CompactListProps {
  items: WorkItem[]
  selectable?: boolean
  selectedIds?: Set<string>
  onSelect?: (id: string) => void
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onNavigate: (id: string) => void
}

function getQuickAction(status: WorkItemStatus): { label: string; nextStatus: WorkItemStatus } | null {
  if (status === 'queued') return { label: 'Activate', nextStatus: 'active' }
  if (status === 'active') return { label: 'Pause', nextStatus: 'paused' }
  if (status === 'paused') return { label: 'Resume', nextStatus: 'active' }
  if (status === 'review') return { label: 'Complete', nextStatus: 'completed' }
  return null
}

export function CompactList({ items, selectable, selectedIds, onSelect, onStatusChange, onNavigate }: CompactListProps) {
  if (items.length === 0) return null

  return (
    <div className={styles.Root}>
      <div className={styles.HeaderRow}>
        {selectable && <span className={styles.ColCheck} />}
        <span className={classnames(styles.ColHeader, styles.ColPriority)}>#</span>
        <span className={classnames(styles.ColHeader, styles.ColTitle)}>Title</span>
        <span className={classnames(styles.ColHeader, styles.ColStatus)}>Status</span>
        <span className={classnames(styles.ColHeader, styles.ColBranch)}>Branch</span>
        <span className={classnames(styles.ColHeader, styles.ColTime)}>Updated</span>
        <span className={classnames(styles.ColHeader, styles.ColAction)} />
      </div>
      {items.map(item => {
        const action = getQuickAction(item.status)
        const unresolvedBlockers = item.blockers.filter(b => !b.resolved)
        return (
          <div
            key={item.id}
            className={classnames(styles.Row, selectedIds?.has(item.id) && styles.RowSelected)}
            onClick={() => onNavigate(item.id)}
          >
            {selectable && (
              <label className={styles.ColCheck} onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds?.has(item.id) ?? false}
                  onChange={() => onSelect?.(item.id)}
                />
              </label>
            )}
            <span className={styles.ColPriority}>{item.priority}</span>
            <span className={styles.ColTitle}>
              <span className={styles.TitleText}>{item.title}</span>
              {unresolvedBlockers.length > 0 && (
                <span className={styles.BlockerCount} title={`${unresolvedBlockers.length} blocker(s)`}>
                  {unresolvedBlockers.length}
                </span>
              )}
              <span className={styles.TypeTag}>{item.type === 'project' ? 'P' : 'QF'}</span>
            </span>
            <span className={styles.ColStatus}>
              <StatusBadge status={item.status} />
            </span>
            <span className={styles.ColBranch}>
              <code className={styles.BranchCode}>{item.branch || '--'}</code>
            </span>
            <span className={styles.ColTime}>
              {timeAgo(item.activated_at || item.created_at)}
            </span>
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
  )
}
