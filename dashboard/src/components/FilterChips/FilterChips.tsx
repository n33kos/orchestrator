import classnames from 'classnames'
import styles from './FilterChips.module.scss'
import type { StatusFilter } from '../SortControls/SortControls.tsx'

interface FilterChipsProps {
  active: StatusFilter
  counts: Record<string, number>
  onChange: (filter: StatusFilter) => void
}

const FILTERS: { id: StatusFilter; label: string; color?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active', color: 'success' },
  { id: 'queued', label: 'Queued', color: 'warning' },
  { id: 'review', label: 'Review', color: 'primary' },
  { id: 'paused', label: 'Paused', color: 'error' },
  { id: 'blocked', label: 'Blocked', color: 'error' },
  { id: 'completed', label: 'Done', color: 'muted' },
]

export function FilterChips({ active, counts, onChange }: FilterChipsProps) {
  return (
    <div className={styles.Root} role="group" aria-label="Filter by status">
      {FILTERS.map(f => {
        const count = f.id === 'all'
          ? Object.values(counts).reduce((s, c) => s + c, 0)
          : (counts[f.id] ?? 0)

        if (f.id !== 'all' && count === 0) return null

        return (
          <button
            key={f.id}
            className={classnames(styles.Chip, active === f.id && styles.ChipActive)}
            data-color={f.color}
            onClick={() => onChange(f.id)}
            aria-pressed={active === f.id}
          >
            {f.label}
            <span className={styles.ChipCount}>{count}</span>
          </button>
        )
      })}
    </div>
  )
}
