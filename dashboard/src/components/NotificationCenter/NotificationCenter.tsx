import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import styles from './NotificationCenter.module.scss'
import type { HistoryEntry } from '../../hooks/useToast.ts'
import type { OrchestratorEvent } from '../../hooks/useEvents.ts'
import { timeAgo } from '../../utils/time.ts'

interface Props {
  history: HistoryEntry[]
  events?: OrchestratorEvent[]
  onClear: () => void
}

const TYPE_ICONS: Record<string, string> = {
  success: '\u2713',
  error: '\u2717',
  info: '\u2139',
}

export function NotificationCenter({ history, events = [], onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [readCount, setReadCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Merge toast history with server events
  const allEntries = useMemo(() => {
    const eventEntries: HistoryEntry[] = events.map(e => ({
      id: `evt-${e.timestamp}-${e.type}`,
      type: e.severity === 'error' ? 'error' as const : e.type.includes('completed') || e.type.includes('merged') ? 'success' as const : 'info' as const,
      message: e.message,
      timestamp: e.timestamp,
    }))
    const merged = [...history, ...eventEntries]
    const seen = new Set<string>()
    return merged
      .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [history, events])

  const unreadCount = Math.max(0, allEntries.length - readCount)

  const handleToggle = useCallback(() => {
    setOpen(prev => {
      if (!prev) {
        setReadCount(allEntries.length)
      }
      return !prev
    })
  }, [allEntries.length])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div ref={containerRef} className={styles.Root}>
      <button className={styles.Bell} onClick={handleToggle} title="Notifications">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className={styles.Badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div className={styles.Dropdown}>
          <div className={styles.DropdownHeader}>
            <span className={styles.DropdownTitle}>Notifications</span>
            {history.length > 0 && (
              <button className={styles.ClearAll} onClick={() => { onClear(); setReadCount(0) }}>
                Clear all
              </button>
            )}
          </div>
          <div className={styles.List}>
            {allEntries.length === 0 ? (
              <div className={styles.Empty}>No notifications yet</div>
            ) : (
              allEntries.slice(0, 30).map((entry) => (
                <div
                  key={entry.id}
                  className={styles.Item}
                >
                  <span className={`${styles.TypeIcon} ${styles[`Type_${entry.type}`]}`}>
                    {TYPE_ICONS[entry.type] || '\u2139'}
                  </span>
                  <div className={styles.ItemContent}>
                    <span className={styles.ItemMessage}>{entry.message}</span>
                    <span className={styles.ItemTime}>{timeAgo(entry.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
