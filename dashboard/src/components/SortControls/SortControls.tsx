import { useState, useRef, useEffect } from 'react'
import classnames from 'classnames'
import styles from './SortControls.module.scss'

export type SortField = 'priority' | 'status' | 'created' | 'title'
export type SortDirection = 'asc' | 'desc'

interface SortControlsProps {
  sortField: SortField
  sortDirection: SortDirection
  onSortChange: (field: SortField, direction: SortDirection) => void
}

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'priority', label: 'Priority' },
  { field: 'status', label: 'Status' },
  { field: 'created', label: 'Date created' },
  { field: 'title', label: 'Title' },
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
      <button className={classnames(styles.DropdownTrigger, open && styles.DropdownOpen)} onClick={onToggle} aria-haspopup="listbox" aria-expanded={open}>
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className={styles.DropdownMenu} role="listbox">{children}</div>}
    </div>
  )
}

export function SortControls({ sortField, sortDirection, onSortChange }: SortControlsProps) {
  const [sortOpen, setSortOpen] = useState(false)

  const currentSort = SORT_OPTIONS.find(o => o.field === sortField)

  return (
    <div className={styles.Root}>
      <Dropdown
        label={`Sort: ${currentSort?.label}`}
        open={sortOpen}
        onToggle={() => setSortOpen(!sortOpen)}
      >
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.field}
            className={classnames(styles.MenuItem, opt.field === sortField && styles.MenuItemActive)}
            role="option"
            aria-selected={opt.field === sortField}
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
    </div>
  )
}
