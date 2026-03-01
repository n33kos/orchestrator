import styles from './StatusFooter.module.scss'
import { RefreshCountdown } from '../RefreshCountdown/RefreshCountdown.tsx'

interface Props {
  totalItems: number
  filteredCount: number
  sessionCount: number
  pollIntervalMs: number
  lastUpdated: Date | null
  viewMode: string
}

export function StatusFooter({ totalItems, filteredCount, sessionCount, pollIntervalMs, lastUpdated, viewMode }: Props) {
  return (
    <footer className={styles.Root}>
      <div className={styles.Left}>
        <span className={styles.Stat}>
          {filteredCount === totalItems
            ? `${totalItems} item${totalItems !== 1 ? 's' : ''}`
            : `${filteredCount} of ${totalItems} items`
          }
        </span>
        <span className={styles.Divider} />
        <span className={styles.Stat}>{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
        <span className={styles.Divider} />
        <span className={styles.Stat}>{viewMode} view</span>
      </div>
      <div className={styles.Right}>
        <RefreshCountdown intervalMs={pollIntervalMs} lastUpdated={lastUpdated} />
      </div>
    </footer>
  )
}
