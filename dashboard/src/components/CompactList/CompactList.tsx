import { useState, useRef, useEffect } from 'react'
import classnames from 'classnames'
import styles from './CompactList.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import { useDragReorder } from '../../hooks/useDragReorder.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface CompactListProps {
  items: WorkItem[]
  selectable?: boolean
  selectedIds?: Set<string>
  onSelect?: (id: string) => void
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onActivateStream?: (id: string) => void
  activatingIds?: Set<string>
  onNavigate: (id: string) => void
  onReorder?: (dragId: string, dropId: string) => void
  onEdit?: (id: string, updates: { title?: string }) => void
}

function getQuickAction(status: WorkItemStatus): { label: string; nextStatus: WorkItemStatus } | null {
  if (status === 'queued' || status === 'planning') return { label: 'Activate', nextStatus: 'active' }
  if (status === 'active') return { label: 'Review', nextStatus: 'review' }
  if (status === 'review') return { label: 'Complete', nextStatus: 'completed' }
  if (status === 'paused') return { label: 'Resume', nextStatus: 'active' }
  return null
}

function InlineEditTitle({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function commit() {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={ref}
      className={styles.InlineEditInput}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
      onClick={e => e.stopPropagation()}
    />
  )
}

export function CompactList({ items, selectable, selectedIds, onSelect, onStatusChange, onActivateStream, activatingIds, onNavigate, onReorder, onEdit }: CompactListProps) {
  const { dragId, overId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } = useDragReorder(onReorder ?? (() => {}))
  const [editingId, setEditingId] = useState<string | null>(null)
  useTimeRefresh(60_000) // force re-render every minute to keep relative times fresh

  if (items.length === 0) {
    return (
      <div className={styles.Empty}>
        <p className={styles.EmptyText}>No matching items</p>
      </div>
    )
  }

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
            className={classnames(
              styles.Row,
              selectedIds?.has(item.id) && styles.RowSelected,
              dragId === item.id && styles.RowDragging,
              overId === item.id && styles.RowDragOver,
            )}
            draggable={!!onReorder}
            onDragStart={() => handleDragStart(item.id)}
            onDragOver={e => { e.preventDefault(); handleDragOver(item.id) }}
            onDrop={() => handleDrop(item.id)}
            onDragEnd={handleDragEnd}
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
            <span className={styles.ColPriority}><PriorityBadge priority={item.priority} /></span>
            <span className={styles.ColTitle}>
              {editingId === item.id ? (
                <InlineEditTitle
                  value={item.title}
                  onSave={v => { onEdit?.(item.id, { title: v }); setEditingId(null) }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span
                  className={styles.TitleText}
                  onDoubleClick={e => { e.stopPropagation(); if (onEdit) setEditingId(item.id) }}
                  title={onEdit ? 'Double-click to edit' : undefined}
                >
                  {item.title}
                </span>
              )}
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
              {action && (() => {
                const isActivating = activatingIds?.has(item.id)
                const useStream = onActivateStream && (item.status === 'queued' || item.status === 'planning' || item.status === 'paused')
                return (
                  <button
                    className={styles.QuickAction}
                    onClick={() => useStream ? onActivateStream(item.id) : onStatusChange(item.id, action.nextStatus)}
                    disabled={isActivating}
                  >
                    {isActivating ? 'Activating...' : action.label}
                  </button>
                )
              })()}
            </span>
          </div>
        )
      })}
    </div>
  )
}
