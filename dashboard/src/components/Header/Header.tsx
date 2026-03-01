import classnames from 'classnames'
import styles from './Header.module.scss'

interface HeaderProps {
  activeCount: number
  queuedCount: number
  pausedCount: number
  blockedCount: number
  onAddClick: () => void
  showingAddForm: boolean
}

export function Header({ activeCount, queuedCount, pausedCount, blockedCount, onAddClick, showingAddForm }: HeaderProps) {
  return (
    <header className={styles.Root}>
      <div className={styles.Left}>
        <div className={styles.Title}>Orchestrator</div>
        <div className={styles.Stats}>
          <span className={styles.Stat}>
            <span className={styles.StatDot} data-status="active" />
            {activeCount} active
          </span>
          {queuedCount > 0 && (
            <span className={styles.Stat}>
              <span className={styles.StatDot} data-status="queued" />
              {queuedCount} queued
            </span>
          )}
          {pausedCount > 0 && (
            <span className={styles.Stat}>
              <span className={styles.StatDot} data-status="paused" />
              {pausedCount} paused
            </span>
          )}
          {blockedCount > 0 && (
            <span className={styles.Stat}>
              <span className={styles.StatDot} data-status="blocked" />
              {blockedCount} blocked
            </span>
          )}
        </div>
      </div>
      <button
        className={classnames(styles.AddButton, showingAddForm && styles.AddButtonActive)}
        onClick={onAddClick}
        title="Add work item"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </header>
  )
}
