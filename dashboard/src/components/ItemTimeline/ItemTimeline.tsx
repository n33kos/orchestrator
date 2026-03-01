import styles from './ItemTimeline.module.scss'

export interface TimelineEvent {
  id: string
  timestamp: string
  type: 'status_change' | 'edit' | 'blocker' | 'comment' | 'system'
  description: string
  meta?: string
}

interface Props {
  events: TimelineEvent[]
  maxHeight?: number
}

const TYPE_ICONS: Record<TimelineEvent['type'], string> = {
  status_change: '\u25CF', // filled circle
  edit: '\u270E',          // pencil
  blocker: '\u26A0',       // warning
  comment: '\u{1F4AC}',    // speech bubble - will use SVG instead
  system: '\u2699',        // gear
}

const TYPE_COLORS: Record<TimelineEvent['type'], string> = {
  status_change: 'var(--color-primary)',
  edit: 'var(--color-warning)',
  blocker: 'var(--color-error)',
  comment: 'var(--color-text-muted)',
  system: 'var(--color-text-muted)',
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return d.toLocaleDateString()
}

export function ItemTimeline({ events, maxHeight }: Props) {
  if (events.length === 0) {
    return <div className={styles.Empty}>No activity yet</div>
  }

  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )

  return (
    <div className={styles.Root} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      {sorted.map((event, i) => (
        <div key={event.id} className={styles.Event}>
          <div className={styles.Indicator}>
            <span
              className={styles.Dot}
              style={{ color: TYPE_COLORS[event.type] }}
            >
              {TYPE_ICONS[event.type]}
            </span>
            {i < sorted.length - 1 && <div className={styles.Line} />}
          </div>
          <div className={styles.Content}>
            <span className={styles.Description}>{event.description}</span>
            <span className={styles.Time} title={new Date(event.timestamp).toLocaleString()}>
              {formatTimestamp(event.timestamp)}
            </span>
            {event.meta && <span className={styles.Meta}>{event.meta}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
