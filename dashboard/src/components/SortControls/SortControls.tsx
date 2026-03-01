import { useState, useRef, useEffect } from 'react'
import classnames from 'classnames'
import styles from './SortControls.module.scss'

export type SortField = 'priority' | 'status' | 'created' | 'title'
export type SortDirection = 'asc' | 'desc'
export type StatusFilter = 'all' | 'active' | 'queued' | 'paused' | 'review' | 'blocked' | 'completed'

interface SortControlsProps {
  sortField: SortField
  sortDirection: SortDirection
  statusFilter: StatusFilter
  onSortChange: (field: SortField, direction: SortDirection) => void
  onStatusFilterChange: (filter: StatusFilter) => void
}

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'priority', label: 'Priority' },
  { field: 'status', label: 'Status' },
  { field: 'created', label: 'Date created' },
  { field: 'title', label: 'Title' },
]

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'queued', label: 'Queued' },
  { value: 'review', label: 'In review' },
  { value: 'paused', label: 'Paused' },
  { value: 'blocked', label: 'Blocked' },
]

function Dropdown({ label, children, open, onToggle }: { label: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onToggle])

  return (
    <div className={styles.Dropdown} ref={ref}>
      <button className={classnames(styles.DropdownTrigger, open && styles.DropdownOpen)} onClick={onToggle}>
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className={styles.DropdownMenu}>{children}</div>}
    </div>
  )
}

export function SortControls({ sortField, sortDirection, statusFilter, onSortChange, onStatusFilterChange }: SortControlsProps) {
  const [sortOpen, setSortOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  const currentSort = SORT_OPTIONS.find(o => o.field === sortField)
  const currentFilter = FILTER_OPTIONS.find(o => o.value === statusFilter)

  return (
    <div className={styles.Root}>
      <Dropdown
        label={`Sort: ${currentSort?.label}`}
        open={sortOpen}
        onToggle={() => { setSortOpen(!sortOpen); setFilterOpen(false) }}
      >
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.field}
            className={classnames(styles.MenuItem, opt.field === sortField && styles.MenuItemActive)}
            onClick={() => {
              if (opt.field === sortField) {
                onSortChange(opt.field, sortDirection === 'asc' ? 'desc' : 'asc')
              } else {
                onSortChange(opt.field, 'asc')
              }
              setSortOpen(false)
            }}
          >
            {opt.label}
            {opt.field === sortField && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {sortDirection === 'asc' ? (
                  <polyline points="18 15 12 9 6 15" />
                ) : (
                  <polyline points="6 9 12 15 18 9" />
                )}
              </svg>
            )}
          </button>
        ))}
      </Dropdown>

      <Dropdown
        label={`Filter: ${currentFilter?.label}`}
        open={filterOpen}
        onToggle={() => { setFilterOpen(!filterOpen); setSortOpen(false) }}
      >
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={classnames(styles.MenuItem, opt.value === statusFilter && styles.MenuItemActive)}
            onClick={() => { onStatusFilterChange(opt.value); setFilterOpen(false) }}
          >
            {opt.label}
          </button>
        ))}
      </Dropdown>
    </div>
  )
}
