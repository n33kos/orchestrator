import { useState, useEffect, useRef, useCallback } from 'react'
import styles from './SchedulerLog.module.scss'

interface SchedulerLogProps {
  lines?: number
}

export function SchedulerLog({ lines = 200 }: SchedulerLogProps) {
  const [logLines, setLogLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [logExists, setLogExists] = useState(true)
  const scrollRef = useRef<HTMLPreElement>(null)
  const isAtBottomRef = useRef(true)

  const fetchLog = useCallback(() => {
    fetch(`/api/scheduler-log?lines=${lines}`)
      .then(r => r.json())
      .then(data => {
        setLogLines(data.lines || [])
        setLogExists(data.exists !== false)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        setError(String(err))
        setLoading(false)
      })
  }, [lines])

  // Track whether user has scrolled to bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 40
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  // Auto-scroll to bottom when new content arrives (if user was at bottom)
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logLines])

  // Initial fetch
  useEffect(() => {
    fetchLog()
  }, [fetchLog])

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchLog, 10_000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchLog])

  return (
    <div className={styles.Root}>
      <div className={styles.Toolbar}>
        <span className={styles.Title}>Scheduler Log</span>
        {!logExists && (
          <span className={styles.NoFile}>Log file not found</span>
        )}
        <div className={styles.ToolbarActions}>
          <label className={styles.AutoRefreshLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={() => setAutoRefresh(prev => !prev)}
            />
            Auto-refresh
          </label>
          <button className={styles.RefreshButton} onClick={fetchLog} title="Refresh now">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
        </div>
      </div>
      {loading ? (
        <div className={styles.Loading}>Loading scheduler log...</div>
      ) : error ? (
        <div className={styles.Error}>{error}</div>
      ) : (
        <pre
          ref={scrollRef}
          className={styles.LogOutput}
          onScroll={handleScroll}
        >
          {logLines.length > 0 ? logLines.join('\n') : 'No log output yet.'}
        </pre>
      )}
    </div>
  )
}
