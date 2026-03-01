import { useState, useEffect } from 'react'
import styles from './RefreshCountdown.module.scss'

interface Props {
  intervalMs: number
  lastUpdated: Date | null
}

export function RefreshCountdown({ intervalMs, lastUpdated }: Props) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!lastUpdated) return null

  const elapsed = now - lastUpdated.getTime()
  const remaining = Math.max(0, intervalMs - elapsed)
  const progress = Math.min(1, elapsed / intervalMs)
  const seconds = Math.ceil(remaining / 1000)

  return (
    <div className={styles.Root} title={`Next refresh in ${seconds}s`}>
      <svg className={styles.Ring} width="18" height="18" viewBox="0 0 18 18">
        <circle
          className={styles.Track}
          cx="9"
          cy="9"
          r="7"
          fill="none"
          strokeWidth="2"
        />
        <circle
          className={styles.Progress}
          cx="9"
          cy="9"
          r="7"
          fill="none"
          strokeWidth="2"
          strokeDasharray={`${2 * Math.PI * 7}`}
          strokeDashoffset={`${2 * Math.PI * 7 * (1 - progress)}`}
          transform="rotate(-90 9 9)"
        />
      </svg>
      {seconds > 0 && <span className={styles.Seconds}>{seconds}s</span>}
    </div>
  )
}
