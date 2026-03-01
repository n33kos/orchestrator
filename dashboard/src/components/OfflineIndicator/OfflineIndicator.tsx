import styles from './OfflineIndicator.module.scss'
import { useOnlineStatus } from '../../hooks/useOnlineStatus.ts'

export function OfflineIndicator() {
  const online = useOnlineStatus()

  if (online) return null

  return (
    <div className={styles.Root}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
        <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0122.56 9" />
        <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
        <path d="M8.53 16.11a6 6 0 016.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span className={styles.Text}>Offline - data may be stale</span>
    </div>
  )
}
