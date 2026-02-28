import styles from './WorkStreamList.module.scss'

export function WorkStreamList() {
  return (
    <div className={styles.Root}>
      <div className={styles.Empty}>
        <div className={styles.EmptyIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
          </svg>
        </div>
        <p className={styles.EmptyText}>No work streams</p>
        <p className={styles.EmptySubtext}>
          Add work items manually or configure sources to discover them automatically.
        </p>
      </div>
    </div>
  )
}
