import { useState, useEffect, useCallback } from 'react'
import styles from './HealthPanel.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'

interface HealthIssue {
  type: string
  message: string
  item_id?: string
  session_id?: string
}

interface DelegatorInfo {
  item_id: string
  health: { status: string }
  cycle_count: number
  last_cycle_at: string | null
  cycle_running: boolean
}

interface HealthData {
  sessions: {
    total: number
    healthy: number
    zombie: number
    zombie_list?: string[]
  }
  queue: {
    active_count: number
    max_concurrent: number
    stalled?: { id: string; title: string; hours: number }[]
    blocked?: { id: string; title: string }[]
  }
  issues: HealthIssue[]
}

interface HealthPanelProps {
  onClose: () => void
  onAutoRecover?: () => void
}

export function HealthPanel({ onClose, onAutoRecover }: HealthPanelProps) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [delegators, setDelegators] = useState<DelegatorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)
  const trapRef = useFocusTrap<HTMLDivElement>()

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    try {
      const [healthRes, delegatorRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/delegators'),
      ])
      if (healthRes.ok) {
        setHealth(await healthRes.json())
      }
      if (delegatorRes.ok) {
        const data = await delegatorRes.json()
        setDelegators(Array.isArray(data.delegators) ? data.delegators : [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleAutoRecover() {
    setRecovering(true)
    onAutoRecover?.()
    // Re-fetch after a delay to let recovery happen
    setTimeout(fetchHealth, 3000)
    setTimeout(() => setRecovering(false), 3000)
  }

  const issueCount = health?.issues?.length ?? 0
  const hasZombies = (health?.sessions?.zombie ?? 0) > 0
  const stalledCount = health?.queue?.stalled?.length ?? 0
  const blockedCount = health?.queue?.blocked?.length ?? 0

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div className={styles.Panel} ref={trapRef} onClick={e => e.stopPropagation()}>
        <div className={styles.Header}>
          <h2 className={styles.Title}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Health Check
          </h2>
          <button className={styles.CloseButton} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className={styles.Loading}>Checking health...</div>
        ) : !health ? (
          <div className={styles.Error}>Failed to fetch health data</div>
        ) : (
          <div className={styles.Content}>
            <div className={styles.StatusGrid}>
              <div className={styles.StatusCard}>
                <span className={styles.StatusValue}>{health.sessions.total}</span>
                <span className={styles.StatusLabel}>Sessions</span>
              </div>
              <div className={styles.StatusCard}>
                <span className={`${styles.StatusValue} ${health.sessions.healthy > 0 ? styles.StatusGood : ''}`}>
                  {health.sessions.healthy}
                </span>
                <span className={styles.StatusLabel}>Healthy</span>
              </div>
              <div className={styles.StatusCard}>
                <span className={`${styles.StatusValue} ${health.sessions.zombie > 0 ? styles.StatusBad : ''}`}>
                  {health.sessions.zombie}
                </span>
                <span className={styles.StatusLabel}>Zombie</span>
              </div>
              <div className={styles.StatusCard}>
                <span className={`${styles.StatusValue} ${health.queue.active_count > health.queue.max_concurrent ? styles.StatusBad : ''}`}>
                  {health.queue.active_count}/{health.queue.max_concurrent}
                </span>
                <span className={styles.StatusLabel}>Active/Max</span>
              </div>
            </div>

            {stalledCount > 0 && (
              <div className={styles.WarningSection}>
                <h3 className={styles.WarnTitle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {stalledCount} Stalled Stream{stalledCount !== 1 ? 's' : ''}
                </h3>
                <div className={styles.WarnList}>
                  {health!.queue.stalled!.map((s, i) => (
                    <div key={i} className={styles.WarnItem}>{s.title} ({s.hours}h)</div>
                  ))}
                </div>
                <p className={styles.WarnHint}>No commit activity detected. Workers may need intervention.</p>
              </div>
            )}

            {blockedCount > 0 && (
              <div className={styles.WarningSection}>
                <h3 className={styles.WarnTitle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  {blockedCount} Blocked Item{blockedCount !== 1 ? 's' : ''}
                </h3>
                <div className={styles.WarnList}>
                  {health!.queue.blocked!.map((b, i) => (
                    <div key={i} className={styles.WarnItem}>{b.title}</div>
                  ))}
                </div>
                <p className={styles.WarnHint}>Items have unresolved blockers preventing progress.</p>
              </div>
            )}

            {issueCount > 0 ? (
              <div className={styles.IssuesList}>
                <h3 className={styles.IssuesTitle}>
                  {issueCount} Issue{issueCount !== 1 ? 's' : ''} Found
                </h3>
                {health.issues.map((issue, i) => (
                  <div key={i} className={styles.Issue}>
                    <span className={`${styles.IssueType} ${styles[`issue_${issue.type}`] || ''}`}>
                      {issue.type}
                    </span>
                    <span className={styles.IssueMessage}>{issue.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.AllClear}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                All systems healthy
              </div>
            )}

            {delegators.length > 0 && (
              <div className={styles.DelegatorSection}>
                <h3 className={styles.IssuesTitle}>
                  Delegators ({delegators.length})
                </h3>
                {delegators.map(d => (
                  <div key={d.item_id} className={styles.DelegatorRow}>
                    <span className={`${styles.DelegatorDot} ${styles[`deleg_${d.health?.status}`] || ''}`} />
                    <span className={styles.DelegatorId}>{d.item_id}</span>
                    <span className={styles.DelegatorStatus}>
                      {d.cycle_running ? 'Running' : d.health?.status || 'unknown'}
                      {d.cycle_count > 0 ? ` (${d.cycle_count} cycles)` : ''}
                    </span>
                    {d.last_cycle_at && (
                      <span className={styles.DelegatorTime}>{new Date(d.last_cycle_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.Actions}>
              <button className={styles.RefreshButton} onClick={fetchHealth}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
                Refresh
              </button>
              {hasZombies && onAutoRecover && (
                <button
                  className={styles.RecoverButton}
                  onClick={handleAutoRecover}
                  disabled={recovering}
                >
                  {recovering ? 'Recovering...' : 'Auto-recover zombies'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
