import classnames from 'classnames'
import styles from './ConnectionStatus.module.scss'

interface ConnectionStatusProps {
  lastUpdated: Date | null
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
}

export function ConnectionStatus({ lastUpdated }: ConnectionStatusProps) {
  const isStale = lastUpdated && (Date.now() - lastUpdated.getTime()) > 15000

  return (
    <div className={classnames(styles.Root, isStale && styles.Stale)}>
      <span className={styles.Dot} />
      <span className={styles.Text}>
        {lastUpdated ? `Synced ${timeAgo(lastUpdated)}` : 'Connecting...'}
      </span>
    </div>
  )
}
