import styles from './StatsBar.module.scss'

interface StatsBarProps {
  totalItems: number
  activeCount: number
  queuedCount: number
  completedCount: number
  blockedCount: number
  showCompleted: boolean
  onToggleCompleted: () => void
}

export function StatsBar({ totalItems, activeCount, queuedCount, completedCount, blockedCount, showCompleted, onToggleCompleted }: StatsBarProps) {
  const inProgressPercent = totalItems > 0 ? Math.round((activeCount / totalItems) * 100) : 0
  const completedPercent = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0

  return (
    <div className={styles.Root}>
      <div className={styles.ProgressSection}>
        <div className={styles.ProgressBar}>
          <div className={styles.ProgressActive} style={{ width: `${inProgressPercent}%` }} />
          <div className={styles.ProgressCompleted} style={{ width: `${completedPercent}%` }} />
        </div>
        <div className={styles.ProgressLabels}>
          <span className={styles.ProgressLabel}>{activeCount} active</span>
          <span className={styles.ProgressLabel}>{queuedCount} queued</span>
          {blockedCount > 0 && (
            <span className={styles.ProgressLabelDanger}>{blockedCount} blocked</span>
          )}
          <span className={styles.ProgressLabel}>{completedCount} done</span>
        </div>
      </div>
      {completedCount > 0 && (
        <button className={styles.CompletedToggle} onClick={onToggleCompleted}>
          {showCompleted ? 'Hide' : 'Show'} completed ({completedCount})
        </button>
      )}
    </div>
  )
}
