import classnames from 'classnames'
import styles from './Header.module.scss'
import { ThemeToggle } from '../ThemeToggle/ThemeToggle.tsx'
import { ConnectionStatus } from '../ConnectionStatus/ConnectionStatus.tsx'

interface HeaderProps {
  activeCount: number
  queuedCount: number
  pausedCount: number
  blockedCount: number
  lastUpdated: Date | null
  onAddClick: () => void
  showingAddForm: boolean
  theme: 'dark' | 'light'
  onThemeToggle: () => void
  onSettingsClick: () => void
}

export function Header({ activeCount, queuedCount, pausedCount, blockedCount, lastUpdated, onAddClick, showingAddForm, theme, onThemeToggle, onSettingsClick }: HeaderProps) {
  return (
    <header className={styles.Root}>
      <div className={styles.Left}>
        <div className={styles.TitleGroup}>
          <div className={styles.Title}>Orchestrator</div>
          <ConnectionStatus lastUpdated={lastUpdated} />
        </div>
        <div className={styles.Stats}>
          <span className={styles.Stat}>
            <span className={styles.StatDot} data-status="active" />
            {activeCount} active
          </span>
          {queuedCount > 0 && (
            <span className={styles.Stat}>
              <span className={styles.StatDot} data-status="queued" />
              {queuedCount} queued
            </span>
          )}
          {pausedCount > 0 && (
            <span className={styles.Stat}>
              <span className={styles.StatDot} data-status="paused" />
              {pausedCount} paused
            </span>
          )}
          {blockedCount > 0 && (
            <span className={styles.Stat}>
              <span className={styles.StatDot} data-status="blocked" />
              {blockedCount} blocked
            </span>
          )}
        </div>
      </div>
      <div className={styles.Actions}>
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <button
          className={styles.SettingsButton}
          onClick={onSettingsClick}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
        <button
          className={classnames(styles.AddButton, showingAddForm && styles.AddButtonActive)}
          onClick={onAddClick}
          title="Add work item"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  )
}
