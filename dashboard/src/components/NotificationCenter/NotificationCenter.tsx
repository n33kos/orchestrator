import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './NotificationCenter.module.scss'
import type { HistoryEntry } from '../../hooks/useToast.ts'
import { timeAgo } from '../../utils/time.ts'

interface Props {
  history: HistoryEntry[]
  onClear: () => void
}

const TYPE_ICONS: Record<string, string> = {
  success: '\u2713',
  error: '\u2717',
  info: '\u2139',
}

export function NotificationCenter({ history, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [readCount, setReadCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const unreadCount = Math.max(0, history.length - readCount)

  const handleToggle = useCallback(() => {
    setOpen(prev => {
      if (!prev) {
        // Opening — mark all as read
        setReadCount(history.length)
      }
      return !prev
    })
  }, [history.length])

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
            {history.length === 0 ? (
              <div className={styles.Empty}>No notifications yet</div>
            ) : (
              history.slice(0, 20).map((entry, i) => (
                <div
                  key={entry.id}
                  className={`${styles.Item} ${i >= readCount - (history.length - readCount) ? '' : ''}`}
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
