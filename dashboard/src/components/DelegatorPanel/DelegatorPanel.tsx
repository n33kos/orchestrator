import { useState } from 'react'
import classnames from 'classnames'
import styles from './DelegatorPanel.module.scss'
import { timeAgo } from '../../utils/time.ts'
import type { DelegatorStatus } from '../../hooks/useDelegators.ts'

interface WorkItem {
  id: string
  title: string
}

interface DelegatorPanelProps {
  delegators: DelegatorStatus[]
  loading: boolean
  items?: WorkItem[]
  onRefresh?: () => void
  onSendMessage?: (sessionId: string, text: string) => void
}

const statusLabels: Record<string, { label: string; cls: string }> = {
  initializing: { label: 'Initializing', cls: 'statusInit' },
  monitoring: { label: 'Monitoring', cls: 'statusActive' },
  reviewing: { label: 'Reviewing', cls: 'statusReview' },
  idle: { label: 'Idle', cls: 'statusIdle' },
  error: { label: 'Error', cls: 'statusError' },
  completed: { label: 'Completed', cls: 'statusDone' },
}

export function DelegatorPanel({ delegators, loading, items, onRefresh, onSendMessage }: DelegatorPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (loading) {
    return <div className={styles.Loading}>Loading delegator status...</div>
  }

  if (delegators.length === 0) {
    return (
      <div className={styles.Empty}>
        <div className={styles.EmptyIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <p className={styles.EmptyTitle}>No active delegators</p>
        <p className={styles.EmptyDesc}>
          Delegators are spawned when work streams are activated with delegator mode enabled. They monitor worker sessions, review commits, and report quality assessments.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.Root}>
      <div className={styles.Summary}>
        <span className={styles.SummaryCount}>{delegators.length}</span>
        <span className={styles.SummaryLabel}>delegator{delegators.length !== 1 ? 's' : ''}</span>
        <span className={styles.SummaryDivider} />
        <span className={styles.SummaryStat}>
          {delegators.reduce((sum, d) => sum + (d.commits_reviewed || 0), 0)} commits reviewed
        </span>
        <span className={styles.SummaryStat}>
          {delegators.reduce((sum, d) => sum + (d.issues_found?.length ?? 0), 0)} issues found
        </span>
        {onRefresh && (
          <button className={styles.RefreshButton} onClick={onRefresh} title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
      </div>

      {delegators.map(d => {
        const isExpanded = expandedId === d.item_id
        const statusInfo = statusLabels[d.status] || { label: d.status, cls: '' }

        return (
          <div key={d.item_id} className={classnames(styles.Card, isExpanded && styles.CardExpanded)}>
            <button
              className={styles.CardHeader}
              onClick={() => setExpandedId(isExpanded ? null : d.item_id)}
            >
              <span className={classnames(styles.StatusDot, styles[statusInfo.cls])} />
              <div className={styles.CardInfo}>
                <span className={styles.CardTitle}>{items?.find(i => i.id === d.item_id)?.title || d.item_id}</span>
                <span className={styles.CardStatus}>{statusInfo.label} &middot; {d.item_id}</span>
              </div>
              <div className={styles.CardStats}>
                <span className={styles.StatChip} title="Commits reviewed">
                  {d.commits_reviewed} commits
                </span>
                {(d.issues_found?.length ?? 0) > 0 && (
                  <span className={classnames(styles.StatChip, styles.StatChipIssue)} title="Issues found">
                    {d.issues_found.length} issue{d.issues_found.length !== 1 ? 's' : ''}
                  </span>
                )}
                {d.stall_detected && (
                  <span className={classnames(styles.StatChip, styles.StatChipStall)}>
                    Stall detected
                  </span>
                )}
              </div>
              <svg
                className={classnames(styles.Chevron, isExpanded && styles.ChevronOpen)}
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isExpanded && (
              <div className={styles.CardBody}>
                <div className={styles.MetaGrid}>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Worker Session</span>
                    <code className={styles.MetaValue}>{d.worker_session}</code>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Branch</span>
                    <code className={styles.MetaValue}>{d.branch}</code>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Started</span>
                    <span className={styles.MetaValue}>{timeAgo(d.started_at)}</span>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Last Check</span>
                    <span className={styles.MetaValue}>{d.last_check ? timeAgo(d.last_check) : 'Never'}</span>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Last Commit</span>
                    <code className={styles.MetaValue}>{d.last_seen_commit?.slice(0, 8) || 'None'}</code>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>PR Reviewed</span>
                    <span className={styles.MetaValue}>{d.pr_reviewed ? 'Yes' : 'No'}</span>
                  </div>
                </div>

                {d.assessment && (
                  <div className={styles.Assessment}>
                    <h4 className={styles.SectionTitle}>Assessment</h4>
                    <p className={styles.AssessmentText}>{d.assessment}</p>
                  </div>
                )}

                {(d.commit_reviews?.length ?? 0) > 0 && (
                  <div className={styles.Section}>
                    <h4 className={styles.SectionTitle}>Commit Reviews ({d.commit_reviews.length})</h4>
                    <div className={styles.ReviewList}>
                      {d.commit_reviews.slice(-5).map((r, i) => (
                        <div key={i} className={styles.ReviewItem}>
                          <code className={styles.CommitHash}>{r.hash.slice(0, 8)}</code>
                          <span className={styles.CommitMsg}>{r.message}</span>
                          <span className={styles.CommitAssessment}>{r.assessment}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(d.issues_found?.length ?? 0) > 0 && (
                  <div className={styles.Section}>
                    <h4 className={styles.SectionTitle}>Issues Found ({d.issues_found.length})</h4>
                    <div className={styles.IssueList}>
                      {d.issues_found.map((issue, i) => (
                        <div key={i} className={classnames(styles.IssueItem, styles[`issue_${issue.severity}`])}>
                          <span className={styles.IssueSeverity}>{issue.severity}</span>
                          <span className={styles.IssueDesc}>{issue.description}</span>
                          {issue.file && <code className={styles.IssueFile}>{issue.file}</code>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(d.errors?.length ?? 0) > 0 && (
                  <div className={styles.Section}>
                    <h4 className={classnames(styles.SectionTitle, styles.ErrorTitle)}>Errors ({d.errors.length})</h4>
                    <div className={styles.ErrorList}>
                      {d.errors.map((err, i) => (
                        <div key={i} className={styles.ErrorItem}>{err}</div>
                      ))}
                    </div>
                  </div>
                )}

                {onSendMessage && d.worker_session && (
                  <div className={styles.MessageSection}>
                    <SendToWorker
                      sessionId={d.worker_session}
                      label="Message worker"
                      onSend={onSendMessage}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SendToWorker({ sessionId, label, onSend }: { sessionId: string; label: string; onSend: (id: string, text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className={styles.SendRow}>
      <input
        className={styles.SendInput}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && text.trim()) {
            onSend(sessionId, text.trim())
            setText('')
          }
        }}
        placeholder={`${label}...`}
        onClick={e => e.stopPropagation()}
      />
      <button
        className={styles.SendButton}
        onClick={e => {
          e.stopPropagation()
          if (text.trim()) {
            onSend(sessionId, text.trim())
            setText('')
          }
        }}
        disabled={!text.trim()}
      >
        Send
      </button>
    </div>
  )
}
