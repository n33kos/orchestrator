import styles from './Header.module.scss'

interface HeaderProps {
  activeCount: number
  queuedCount: number
  pausedCount: number
}

export function Header({ activeCount, queuedCount, pausedCount }: HeaderProps) {
  return (
    <header className={styles.Root}>
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
      </div>
    </header>
  )
}
