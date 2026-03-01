import { useState, useEffect, useRef } from 'react'
import styles from './SessionLog.module.scss'

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

interface Props {
  sessionId: string
  maxLines?: number
}

export function SessionLog({ sessionId, maxLines = 100 }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/logs?limit=${maxLines}`)
        if (res.ok) {
          const data = await res.json()
          setLogs(data.logs || [])
        }
      } catch { /* ignore */ }
      setLoading(false)
    }

    fetchLogs()
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [sessionId, maxLines])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const levelColors: Record<string, string> = {
    info: 'var(--color-primary)',
    warn: 'var(--color-warning)',
    error: 'var(--color-error)',
    debug: 'var(--color-text-muted)',
  }

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <span className={styles.Title}>Session Log</span>
        <label className={styles.AutoScroll}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>
      <div ref={containerRef} className={styles.LogContainer}>
        {loading && <div className={styles.Loading}>Loading logs...</div>}
        {!loading && logs.length === 0 && (
          <div className={styles.Empty}>No log entries</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className={styles.Entry}>
            <span className={styles.Timestamp}>
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className={styles.Level} style={{ color: levelColors[entry.level] }}>
              {entry.level.toUpperCase()}
            </span>
            <span className={styles.Message}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
