import { useState, useRef, useEffect, useMemo } from 'react'
import classnames from 'classnames'
import styles from './CompactList.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import { useDragReorder } from '../../hooks/useDragReorder.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

type SortCol = 'priority' | 'title' | 'status' | 'branch' | 'time'
type SortDir = 'asc' | 'desc'

const STATUS_ORDER: Record<string, number> = { active: 0, review: 1, planning: 2, queued: 3, completed: 4 }

interface CompactListProps {
  items: WorkItem[]
  selectable?: boolean
  selectedIds?: Set<string>
  onSelect?: (id: string) => void
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onActivateStream?: (id: string) => void
  activatingIds?: Set<string>
  focusedItemId?: string | null
  onNavigate: (id: string) => void
  onReorder?: (dragId: string, dropId: string) => void
  onEdit?: (id: string, updates: { title?: string }) => void
}

function getQuickAction(status: WorkItemStatus): { label: string; nextStatus: WorkItemStatus } | null {
  if (status === 'queued' || status === 'planning') return { label: 'Activate', nextStatus: 'active' }
  if (status === 'active') return { label: 'Review', nextStatus: 'review' }
  if (status === 'review') return { label: 'Complete', nextStatus: 'completed' }
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

export function CompactList({ items, selectable, selectedIds, onSelect, onStatusChange, onActivateStream, activatingIds, focusedItemId, onNavigate, onReorder, onEdit }: CompactListProps) {
  const { dragId, overId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } = useDragReorder(onReorder ?? (() => {}))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<SortCol | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  useTimeRefresh(60_000) // force re-render every minute to keep relative times fresh

  function handleHeaderClick(col: SortCol) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortCol(null); setSortDir('asc') } // third click clears sort
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sortedItems = useMemo(() => {
    if (!sortCol) return items
    const sorted = [...items]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'priority': cmp = a.priority - b.priority; break
        case 'title': cmp = a.title.localeCompare(b.title); break
        case 'status': cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99); break
        case 'branch': cmp = (a.environment?.branch || '').localeCompare(b.environment?.branch || ''); break
        case 'time': cmp = new Date(a.activated_at || a.created_at).getTime() - new Date(b.activated_at || b.created_at).getTime(); break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [items, sortCol, sortDir])

  function sortIndicator(col: SortCol) {
    if (sortCol !== col) return null
    return <span className={styles.SortArrow}>{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
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
      <div className={styles.HeaderRow}>
        {selectable && <span className={styles.ColCheck} />}
        <span className={classnames(styles.ColHeader, styles.ColPriority, sortCol === 'priority' && styles.ColHeaderActive)} onClick={() => handleHeaderClick('priority')}># {sortIndicator('priority')}</span>
        <span className={classnames(styles.ColHeader, styles.ColTitle, sortCol === 'title' && styles.ColHeaderActive)} onClick={() => handleHeaderClick('title')}>Title {sortIndicator('title')}</span>
        <span className={classnames(styles.ColHeader, styles.ColStatus, sortCol === 'status' && styles.ColHeaderActive)} onClick={() => handleHeaderClick('status')}>Status {sortIndicator('status')}</span>
        <span className={classnames(styles.ColHeader, styles.ColBranch, sortCol === 'branch' && styles.ColHeaderActive)} onClick={() => handleHeaderClick('branch')}>Branch {sortIndicator('branch')}</span>
        <span className={classnames(styles.ColHeader, styles.ColTime, sortCol === 'time' && styles.ColHeaderActive)} onClick={() => handleHeaderClick('time')}>Updated {sortIndicator('time')}</span>
        <span className={classnames(styles.ColHeader, styles.ColAction)} />
      </div>
      {sortedItems.map(item => {
        const action = getQuickAction(item.status)
        const blockedByCount = (item.blocked_by || []).length
        return (
          <div
            key={item.id}
            className={classnames(
              styles.Row,
              selectedIds?.has(item.id) && styles.RowSelected,
              dragId === item.id && styles.RowDragging,
              overId === item.id && styles.RowDragOver,
              focusedItemId === item.id && styles.RowFocused,
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
              {blockedByCount > 0 && (
                <span className={styles.DepCount} title={`Blocked by ${item.blocked_by.join(', ')}`}>
                  {blockedByCount}
                </span>
              )}
            </span>
            <span className={styles.ColStatus}>
              <StatusBadge status={item.status} />
            </span>
            <span className={styles.ColBranch}>
              <code className={styles.BranchCode}>{item.environment?.branch || '--'}</code>
            </span>
            <span className={styles.ColTime}>
              {timeAgo(item.activated_at || item.created_at)}
            </span>
            <span className={styles.ColAction} onClick={e => e.stopPropagation()}>
              {action && (() => {
                const isActivating = activatingIds?.has(item.id)
                const useStream = onActivateStream && (item.status === 'queued' || item.status === 'planning')
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
