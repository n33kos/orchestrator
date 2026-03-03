import classnames from 'classnames'
import styles from './FilterChips.module.scss'
import type { WorkItemStatus } from '../../types.ts'

interface FilterChipsProps {
  activeStatuses: Set<WorkItemStatus>
  counts: Record<string, number>
  onToggle: (status: WorkItemStatus) => void
}

const FILTERS: { id: WorkItemStatus; label: string; color?: string }[] = [
  { id: 'active', label: 'Active', color: 'success' },
  { id: 'planning', label: 'Planning', color: 'primary' },
  { id: 'queued', label: 'Queued', color: 'warning' },
  { id: 'review', label: 'Review', color: 'primary' },
  { id: 'completed', label: 'Completed', color: 'muted' },
]

export function FilterChips({ activeStatuses, counts, onToggle }: FilterChipsProps) {
  return (
    <div className={styles.Root} role="group" aria-label="Filter by status">
      {FILTERS.map(f => {
        const count = counts[f.id] ?? 0
        const isActive = activeStatuses.has(f.id)

        return (
          <button
            key={f.id}
            className={classnames(styles.Chip, isActive && styles.ChipActive)}
            data-color={f.color}
            onClick={() => onToggle(f.id)}
            aria-pressed={isActive}
          >
            {f.label}
            <span className={styles.ChipCount}>{count}</span>
          </button>
        )
      })}
    </div>
  )
}
