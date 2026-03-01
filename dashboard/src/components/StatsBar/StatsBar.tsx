import styles from './StatsBar.module.scss'

interface StatsBarProps {
  totalItems: number
  activeCount: number
  queuedCount: number
  pausedCount: number
  completedCount: number
  blockedCount: number
  showCompleted: boolean
  onToggleCompleted: () => void
}

export function StatsBar({ totalItems, activeCount, queuedCount, pausedCount, completedCount, blockedCount, showCompleted, onToggleCompleted }: StatsBarProps) {
  function pct(n: number) {
    return totalItems > 0 ? (n / totalItems) * 100 : 0
  }

  const segments = [
    { key: 'active', pct: pct(activeCount), cls: styles.SegActive },
    { key: 'queued', pct: pct(queuedCount), cls: styles.SegQueued },
    { key: 'paused', pct: pct(pausedCount), cls: styles.SegPaused },
    { key: 'completed', pct: pct(completedCount), cls: styles.SegCompleted },
  ].filter(s => s.pct > 0)

  return (
    <div className={styles.Root}>
      <div className={styles.ProgressSection}>
        <div className={styles.ProgressBar}>
          {segments.map(seg => (
            <div key={seg.key} className={seg.cls} style={{ width: `${seg.pct}%` }} />
          ))}
        </div>
        <div className={styles.ProgressLabels}>
          <span className={styles.ProgressLabel}>
            <span className={styles.LabelDot} data-status="active" />
            {activeCount} active
          </span>
          <span className={styles.ProgressLabel}>
            <span className={styles.LabelDot} data-status="queued" />
            {queuedCount} queued
          </span>
          {pausedCount > 0 && (
            <span className={styles.ProgressLabel}>
              <span className={styles.LabelDot} data-status="paused" />
              {pausedCount} paused
            </span>
          )}
          {blockedCount > 0 && (
            <span className={styles.ProgressLabelDanger}>
              <span className={styles.LabelDot} data-status="blocked" />
              {blockedCount} blocked
            </span>
          )}
          <span className={styles.ProgressLabel}>
            <span className={styles.LabelDot} data-status="completed" />
            {completedCount} done
          </span>
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
