import styles from './ActivityLog.module.scss'

interface ActivityEntry {
  timestamp: string
  action: string
  detail?: string
}

interface ActivityLogProps {
  entries: ActivityEntry[]
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ActivityLog({ entries }: ActivityLogProps) {
  if (entries.length === 0) {
    return (
      <div className={styles.Empty}>
        No activity recorded yet
      </div>
    )
  }

  return (
    <div className={styles.Root}>
      {entries.map((entry, i) => (
        <div key={i} className={styles.Entry}>
          <div className={styles.Dot} />
          {i < entries.length - 1 && <div className={styles.Line} />}
          <div className={styles.Content}>
            <span className={styles.Action}>{entry.action}</span>
            {entry.detail && <span className={styles.Detail}>{entry.detail}</span>}
            <span className={styles.Time}>{timeAgo(entry.timestamp)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
