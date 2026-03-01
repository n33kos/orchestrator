import classnames from 'classnames'
import styles from './Header.module.scss'
import { ThemeToggle } from '../ThemeToggle/ThemeToggle.tsx'
import { ConnectionStatus } from '../ConnectionStatus/ConnectionStatus.tsx'
import { Sparkline } from '../Sparkline/Sparkline.tsx'
import { NotificationCenter } from '../NotificationCenter/NotificationCenter.tsx'
import type { HistoryEntry } from '../../hooks/useToast.ts'

interface HeaderProps {
  activeCount: number
  queuedCount: number
  pausedCount: number
  blockedCount: number
  sessionCount: number
  workersActiveCount: number
  zombieCount: number
  activityCount: number
  activitySparkline: number[]
  healthIssues: number
  lastUpdated: Date | null
  notificationHistory: HistoryEntry[]
  onClearNotifications: () => void
  onAddClick: () => void
  showingAddForm: boolean
  theme: 'dark' | 'light'
  onThemeToggle: () => void
  onSettingsClick: () => void
  onSessionsClick: () => void
  onActivityFeedClick: () => void
  onHealthClick: () => void
  onDiscoverClick: () => void
}

export function Header({ activeCount, queuedCount, pausedCount, blockedCount, sessionCount, workersActiveCount, zombieCount, activityCount, activitySparkline, healthIssues, lastUpdated, notificationHistory, onClearNotifications, onAddClick, showingAddForm, theme, onThemeToggle, onSettingsClick, onSessionsClick, onActivityFeedClick, onHealthClick, onDiscoverClick }: HeaderProps) {
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
        {activitySparkline.some(v => v > 0) && (
          <div className={styles.SparklineWrapper} title="Activity over the last hour">
            <Sparkline data={activitySparkline} width={60} height={18} />
          </div>
        )}
      </div>
      <div className={styles.Actions}>
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <button
          className={styles.DiscoverButton}
          onClick={onDiscoverClick}
          title="Discover work"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button
          className={classnames(styles.HealthButton, healthIssues > 0 && styles.HealthButtonAlert)}
          onClick={onHealthClick}
          title={healthIssues > 0 ? `${healthIssues} health issue${healthIssues !== 1 ? 's' : ''}` : 'Health check'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          {healthIssues > 0 && <span className={styles.HealthBadge}>{healthIssues > 9 ? '9+' : healthIssues}</span>}
        </button>
        <button
          className={styles.ActivityButton}
          onClick={onActivityFeedClick}
          title="Activity feed"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {activityCount > 0 && <span className={styles.ActivityBadge}>{activityCount > 9 ? '9+' : activityCount}</span>}
        </button>
        <NotificationCenter history={notificationHistory} onClear={onClearNotifications} />
        <button
          className={classnames(styles.SessionsButton, zombieCount > 0 && styles.SessionsButtonZombie)}
          onClick={onSessionsClick}
          title={workersActiveCount > 0 ? `${workersActiveCount} worker${workersActiveCount > 1 ? 's' : ''} active` : `${sessionCount} session${sessionCount !== 1 ? 's' : ''}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          {workersActiveCount > 0 && <span className={styles.WorkerPulse} />}
          {sessionCount > 0 && <span className={styles.SessionsBadge}>{sessionCount}</span>}
        </button>
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
