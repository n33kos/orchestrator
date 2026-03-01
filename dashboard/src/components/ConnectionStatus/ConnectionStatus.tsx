import { useState, useEffect } from 'react'
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
  const [, setTick] = useState(0)

  // Re-render every 5 seconds to update relative time
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(interval)
  }, [])

  const staleness = lastUpdated ? Date.now() - lastUpdated.getTime() : Infinity
  const isRecent = staleness < 5000
  const isStale = staleness > 15000
  const isDisconnected = staleness > 30000

  return (
    <div className={classnames(
      styles.Root,
      isRecent && styles.Recent,
      isStale && !isDisconnected && styles.Stale,
      isDisconnected && styles.Disconnected,
    )}>
      <span className={styles.Dot} />
      <span className={styles.Text}>
        {!lastUpdated ? 'Connecting...'
          : isDisconnected ? `Lost connection (${timeAgo(lastUpdated)})`
          : `Synced ${timeAgo(lastUpdated)}`}
      </span>
    </div>
  )
}
