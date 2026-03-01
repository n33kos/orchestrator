import styles from './StatusFooter.module.scss'
import { RefreshCountdown } from '../RefreshCountdown/RefreshCountdown.tsx'

interface Props {
  totalItems: number
  filteredCount: number
  sessionCount: number
  pollIntervalMs: number
  lastUpdated: Date | null
  viewMode: string
  latencyMs?: number | null
}

export function StatusFooter({ totalItems, filteredCount, sessionCount, pollIntervalMs, lastUpdated, viewMode, latencyMs }: Props) {
  const latencyColor = latencyMs == null ? 'var(--color-text-muted)'
    : latencyMs < 200 ? 'var(--color-success)'
    : latencyMs < 500 ? 'var(--color-warning)'
    : 'var(--color-error)'

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
        {latencyMs != null && (
          <>
            <span className={styles.Divider} />
            <span className={styles.Stat} title="API response time">
              <span className={styles.LatencyDot} style={{ background: latencyColor }} />
              {latencyMs}ms
            </span>
          </>
        )}
      </div>
      <div className={styles.Right}>
        <RefreshCountdown intervalMs={pollIntervalMs} lastUpdated={lastUpdated} />
      </div>
    </footer>
  )
}
