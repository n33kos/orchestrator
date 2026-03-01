import { useState, useEffect } from 'react'
import styles from './ActiveTimer.module.scss'

interface Props {
  activatedAt: string | null
  status: string
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function ActiveTimer({ activatedAt, status }: Props) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (status !== 'active') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [status])

  if (!activatedAt || status !== 'active') return null

  const elapsed = now - new Date(activatedAt).getTime()

  return (
    <span className={styles.Root} title="Time since activation">
      <svg className={styles.Icon} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span className={styles.Time}>{formatElapsed(elapsed)}</span>
    </span>
  )
}
