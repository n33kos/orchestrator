import styles from './AnalyticsView.module.scss'
import { StatusChart } from '../StatusChart/StatusChart.tsx'
import { BarChart } from '../BarChart/BarChart.tsx'
import type { WorkItem, SessionInfo } from '../../types.ts'

interface Props {
  items: WorkItem[]
  sessions: SessionInfo[]
}

export function AnalyticsView({ items, sessions }: Props) {
  // Status counts
  const statusCounts = {
    active: items.filter(i => i.status === 'active').length,
    queued: items.filter(i => i.status === 'queued').length,
    review: items.filter(i => i.status === 'review').length,
    paused: items.filter(i => i.status === 'paused').length,
    completed: items.filter(i => i.status === 'completed').length,
  }

  // Type distribution
  const projects = items.filter(i => i.type === 'project').length
  const quickFixes = items.filter(i => i.type === 'quick_fix').length

  // Priority distribution
  const priorityBuckets = [
    { label: '1-10', value: items.filter(i => i.priority >= 1 && i.priority <= 10).length, color: 'var(--color-error)' },
    { label: '11-25', value: items.filter(i => i.priority >= 11 && i.priority <= 25).length, color: 'var(--color-warning)' },
    { label: '26-50', value: items.filter(i => i.priority >= 26 && i.priority <= 50).length, color: 'var(--color-primary)' },
    { label: '51-75', value: items.filter(i => i.priority >= 51 && i.priority <= 75).length, color: 'var(--color-text-muted)' },
    { label: '76+', value: items.filter(i => i.priority >= 76).length, color: 'var(--color-border)' },
  ]

  // Session state distribution
  const sessionStates = [
    { label: 'Ready', value: sessions.filter(s => s.state === 'standby').length, color: 'var(--color-success)' },
    { label: 'Running', value: sessions.filter(s => s.state === 'running').length, color: 'var(--color-primary)' },
    { label: 'Zombie', value: sessions.filter(s => s.state === 'zombie').length, color: 'var(--color-error)' },
    { label: 'Idle', value: sessions.filter(s => s.state === 'idle').length, color: 'var(--color-warning)' },
  ]

  // Blocker stats
  const totalBlockers = items.reduce((acc, i) => acc + i.blockers.length, 0)
  const unresolvedBlockers = items.reduce((acc, i) => acc + i.blockers.filter(b => !b.resolved).length, 0)

  // Average items per day (based on created_at)
  const now = Date.now()
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000
  const recentItems = items.filter(i => new Date(i.created_at).getTime() > oneWeekAgo)
  const avgPerDay = (recentItems.length / 7).toFixed(1)

  return (
    <div className={styles.Root}>
      <div className={styles.Grid}>
        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Status Distribution</h3>
          <div className={styles.ChartCenter}>
            <StatusChart {...statusCounts} />
          </div>
          <div className={styles.Legend}>
            {Object.entries(statusCounts).map(([key, count]) => (
              <div key={key} className={styles.LegendItem}>
                <span className={styles.LegendLabel}>{key}</span>
                <span className={styles.LegendValue}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Priority Distribution</h3>
          <BarChart bars={priorityBuckets} height={100} />
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Type Breakdown</h3>
          <div className={styles.TypeRow}>
            <div className={styles.TypeItem}>
              <span className={styles.TypeValue}>{projects}</span>
              <span className={styles.TypeLabel}>Projects</span>
            </div>
            <div className={styles.TypeItem}>
              <span className={styles.TypeValue}>{quickFixes}</span>
              <span className={styles.TypeLabel}>Quick Fixes</span>
            </div>
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Session Health</h3>
          <BarChart bars={sessionStates} height={80} />
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Blockers</h3>
          <div className={styles.BlockerStats}>
            <div className={styles.BlockerItem}>
              <span className={styles.BlockerValue} style={{ color: 'var(--color-error)' }}>{unresolvedBlockers}</span>
              <span className={styles.BlockerLabel}>Open</span>
            </div>
            <div className={styles.BlockerItem}>
              <span className={styles.BlockerValue} style={{ color: 'var(--color-success)' }}>{totalBlockers - unresolvedBlockers}</span>
              <span className={styles.BlockerLabel}>Resolved</span>
            </div>
            <div className={styles.BlockerItem}>
              <span className={styles.BlockerValue}>{totalBlockers}</span>
              <span className={styles.BlockerLabel}>Total</span>
            </div>
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Velocity</h3>
          <div className={styles.VelocityStat}>
            <span className={styles.VelocityValue}>{avgPerDay}</span>
            <span className={styles.VelocityLabel}>items / day (7-day avg)</span>
          </div>
          <div className={styles.VelocityStat}>
            <span className={styles.VelocityValue}>{items.length}</span>
            <span className={styles.VelocityLabel}>total items</span>
          </div>
        </div>
      </div>
    </div>
  )
}
