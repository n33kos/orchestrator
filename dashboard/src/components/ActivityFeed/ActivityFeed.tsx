import classnames from 'classnames'
import styles from './ActivityFeed.module.scss'
import type { HistoryEntry } from '../../hooks/useToast.ts'

interface ActivityFeedProps {
  history: HistoryEntry[]
  onClear: () => void
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function groupByTimeWindow(entries: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const now = Date.now()
  const groups: { label: string; entries: HistoryEntry[] }[] = [
    { label: 'Last 5 minutes', entries: [] },
    { label: 'Last 30 minutes', entries: [] },
    { label: 'Earlier', entries: [] },
  ]

  for (const entry of entries) {
    const age = now - new Date(entry.timestamp).getTime()
    if (age < 5 * 60 * 1000) {
      groups[0].entries.push(entry)
    } else if (age < 30 * 60 * 1000) {
      groups[1].entries.push(entry)
    } else {
      groups[2].entries.push(entry)
    }
  }

  return groups.filter(g => g.entries.length > 0)
}

const TYPE_ICONS: Record<string, React.JSX.Element> = {
  success: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

export function ActivityFeed({ history, onClear, onClose }: ActivityFeedProps) {
  const groups = groupByTimeWindow(history)

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div className={styles.Panel} onClick={e => e.stopPropagation()}>
        <div className={styles.Header}>
          <h2 className={styles.Title}>Activity Feed</h2>
          <div className={styles.HeaderActions}>
            {history.length > 0 && (
              <button className={styles.ClearButton} onClick={onClear}>
                Clear
              </button>
            )}
            <button className={styles.CloseButton} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.Body}>
          {history.length === 0 ? (
            <div className={styles.Empty}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p>No activity yet</p>
              <p className={styles.EmptySubtext}>Actions you perform will appear here.</p>
            </div>
          ) : (
            groups.map(group => (
              <div key={group.label} className={styles.Group}>
                <h3 className={styles.GroupLabel}>{group.label}</h3>
                <div className={styles.Entries}>
                  {group.entries.map(entry => (
                    <div key={entry.id} className={classnames(styles.Entry, styles[entry.type])}>
                      <span className={styles.EntryIcon}>{TYPE_ICONS[entry.type]}</span>
                      <span className={styles.EntryMessage}>{entry.message}</span>
                      <span className={styles.EntryTime}>{formatTime(entry.timestamp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
