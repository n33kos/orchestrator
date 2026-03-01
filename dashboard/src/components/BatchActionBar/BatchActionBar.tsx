import classnames from 'classnames'
import styles from './BatchActionBar.module.scss'
import type { WorkItemStatus } from '../../types.ts'

interface BatchActionBarProps {
  selectedCount: number
  onStatusChange: (status: WorkItemStatus) => void
  onDelete: () => void
  onClearSelection: () => void
}

export function BatchActionBar({ selectedCount, onStatusChange, onDelete, onClearSelection }: BatchActionBarProps) {
  return (
    <div className={styles.Root}>
      <div className={styles.Left}>
        <span className={styles.Count}>{selectedCount} selected</span>
        <button className={styles.ClearButton} onClick={onClearSelection}>
          Clear
        </button>
      </div>
      <div className={styles.Actions}>
        <button
          className={styles.ActionButton}
          onClick={() => onStatusChange('active')}
          title="Activate all selected"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Activate
        </button>
        <button
          className={styles.ActionButton}
          onClick={() => onStatusChange('paused')}
          title="Pause all selected"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
          Pause
        </button>
        <button
          className={styles.ActionButton}
          onClick={() => onStatusChange('completed')}
          title="Complete all selected"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Complete
        </button>
        <button
          className={classnames(styles.ActionButton, styles.ActionDanger)}
          onClick={onDelete}
          title="Remove all selected"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          Remove
        </button>
      </div>
    </div>
  )
}
