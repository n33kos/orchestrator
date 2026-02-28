import styles from './Header.module.scss'

export function Header() {
  return (
    <header className={styles.Root}>
      <div className={styles.Title}>Orchestrator</div>
      <div className={styles.Stats}>
        <span className={styles.Stat}>
          <span className={styles.StatDot} data-status="active" />
          0 active
        </span>
        <span className={styles.Stat}>
          <span className={styles.StatDot} data-status="queued" />
          0 queued
        </span>
      </div>
    </header>
  )
}
