import { useState, useCallback } from 'react'
import classnames from 'classnames'
import styles from './DelegatorPanel.module.scss'
import { timeAgo } from '../../utils/time.ts'
import type { DelegatorStatus } from '../../hooks/useDelegators.ts'

interface WorkItem {
  id: string
  title: string
  status?: ItemStatus
  worker?: { delegator_enabled?: boolean }
  runtime?: { spend?: Record<string, unknown> | null }
}

interface DelegatorPanelProps {
  delegators: DelegatorStatus[]
  loading: boolean
  items?: WorkItem[]
  onRefresh?: () => void
}

const healthLabels: Record<string, { label: string; cls: string }> = {
  healthy: { label: 'Healthy', cls: 'statusActive' },
  standby: { label: 'Standby', cls: 'statusIdle' },
  stale: { label: 'Stale', cls: 'statusIdle' },
  disabled: { label: 'Disabled', cls: 'statusInit' },
  error: { label: 'Error', cls: 'statusError' },
}

type ItemStatus = 'queued' | 'planning' | 'active' | 'review' | 'completed'

/**
 * Derive effective delegator health based on both the state file health
 * and the parent work item's current status / delegator_enabled flag.
 */
function deriveEffectiveHealth(
  rawHealth: string,
  itemStatus: ItemStatus | undefined,
  delegatorEnabled: boolean | undefined,
  stallDetected: boolean,
): string {
  if (stallDetected) return 'stale'
  if (rawHealth === 'error') return 'error'
  if (delegatorEnabled === false) return 'disabled'
  const activeStatuses: ItemStatus[] = ['active', 'review']
  if (itemStatus && !activeStatuses.includes(itemStatus)) return 'standby'
  return rawHealth // healthy or stale pass through
}

const statusLabels: Record<string, { label: string; cls: string }> = {
  initializing: { label: 'Initializing', cls: 'statusInit' },
  monitoring: { label: 'Monitoring', cls: 'statusActive' },
  reviewing: { label: 'Reviewing', cls: 'statusReview' },
  idle: { label: 'Idle', cls: 'statusIdle' },
  error: { label: 'Error', cls: 'statusError' },
  completed: { label: 'Completed', cls: 'statusDone' },
}

function parseTriageOutput(raw: unknown): { decision: string; reason: string } | null {
  if (raw == null) return null

  let obj: Record<string, unknown> | null = null

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>
  } else if (typeof raw === 'string') {
    // May be raw JSON or wrapped in markdown code fences
    let trimmed = raw.trim()
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
    if (fenceMatch) {
      trimmed = fenceMatch[1].trim()
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        obj = parsed
      }
    } catch {
      return null
    }
  }

  if (!obj || !obj.decision) return null
  return {
    decision: String(obj.decision),
    reason: obj.reason ? String(obj.reason) : '',
  }
}

const decisionStyles: Record<string, string> = {
  no_action: 'decisionMuted',
  handle: 'decisionHandle',
  escalate: 'decisionEscalate',
}

function CollapsibleJson({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  if (data == null) return null

  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])

  return (
    <div className={styles.Section}>
      <button className={styles.CollapsibleHeader} onClick={() => setOpen(o => !o)}>
        <svg
          className={classnames(styles.Chevron, open && styles.ChevronOpen)}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <h4 className={styles.SectionTitle}>{label}</h4>
        {open && (
          <button
            className={styles.CopyJsonButton}
            onClick={e => { e.stopPropagation(); handleCopy() }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </button>
      {open && (
        <pre className={styles.JsonBlock}>{text}</pre>
      )}
    </div>
  )
}

export function DelegatorPanel({ delegators, loading, items, onRefresh }: DelegatorPanelProps) {
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

  // Derive effective health for each delegator, accounting for item status
  const effectiveHealthMap = new Map<string, string>()
  for (const d of delegators) {
    const matchedItem = items?.find(i => i.id === d.item_id)
    const effective = deriveEffectiveHealth(
      d.health?.status || 'unknown',
      matchedItem?.status as ItemStatus | undefined,
      matchedItem?.worker?.delegator_enabled,
      d.stall_detected,
    )
    effectiveHealthMap.set(d.item_id, effective)
  }

  const healthyCount = delegators.filter(d => effectiveHealthMap.get(d.item_id) === 'healthy').length
  const standbyCount = delegators.filter(d => effectiveHealthMap.get(d.item_id) === 'standby').length
  const staleCount = delegators.filter(d => effectiveHealthMap.get(d.item_id) === 'stale').length
  const errorCount = delegators.filter(d => effectiveHealthMap.get(d.item_id) === 'error').length

  // Aggregate delegator spend across all items
  const totalDelegatorSpend = delegators.reduce((sum, d) => {
    const matchedItem = items?.find(i => i.id === d.item_id)
    const spend = matchedItem?.runtime?.spend as { delegator_usd?: number } | undefined
    return sum + (spend?.delegator_usd ?? 0)
  }, 0)

  return (
    <div className={styles.Root}>
      <div className={styles.Summary}>
        <span className={styles.SummaryCount}>{delegators.length}</span>
        <span className={styles.SummaryLabel}>delegator{delegators.length !== 1 ? 's' : ''}</span>
        {(standbyCount > 0 || staleCount > 0 || errorCount > 0) && (
          <>
            <span className={styles.SummaryDivider} />
            <span className={classnames(styles.SummaryStat, styles.SummaryStatWarn)}>
              {healthyCount} healthy{standbyCount > 0 ? ` · ${standbyCount} standby` : ''}{staleCount > 0 ? ` · ${staleCount} stale` : ''}{errorCount > 0 ? ` · ${errorCount} error` : ''}
            </span>
          </>
        )}
        <span className={styles.SummaryDivider} />
        <span className={styles.SummaryStat}>
          {delegators.reduce((sum, d) => sum + (d.commits_reviewed || 0), 0)} commits reviewed
        </span>
        <span className={styles.SummaryStat}>
          {delegators.reduce((sum, d) => sum + (d.issues_found?.length ?? 0), 0)} issues found
        </span>
        {totalDelegatorSpend > 0 && (
          <>
            <span className={styles.SummaryDivider} />
            <span className={styles.SummaryStat}>
              ${totalDelegatorSpend.toFixed(2)} delegator spend
            </span>
          </>
        )}
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
        const healthStatus = effectiveHealthMap.get(d.item_id) || d.health?.status || 'unknown'
        const healthInfo = healthLabels[healthStatus] || { label: healthStatus, cls: '' }

        return (
          <div key={d.item_id} className={classnames(styles.Card, isExpanded && styles.CardExpanded, healthStatus === 'error' && styles.CardDead)}>
            <button
              className={styles.CardHeader}
              onClick={() => setExpandedId(isExpanded ? null : d.item_id)}
            >
              <span className={classnames(styles.StatusDot, styles[healthInfo.cls])} />
              <div className={styles.CardInfo}>
                <span className={styles.CardTitle}>{items?.find(i => i.id === d.item_id)?.title || d.item_id}</span>
                <span className={styles.CardStatus}>{d.cycle_running ? 'Running cycle' : healthInfo.label} &middot; {d.cycle_count ?? 0} cycles &middot; {d.item_id}</span>
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
                    <span className={styles.MetaLabel}>Status</span>
                    <span className={styles.MetaValue}>
                      {healthInfo.label}
                      {d.health?.consecutive_errors > 0 && ` (${d.health.consecutive_errors} errors)`}
                    </span>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Branch</span>
                    <code className={styles.MetaValue}>{d.branch}</code>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Created</span>
                    <span className={styles.MetaValue}>{timeAgo(d.created_at)}</span>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Last Cycle</span>
                    <span className={styles.MetaValue}>{d.last_cycle_at ? timeAgo(d.last_cycle_at) : 'Never'}</span>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>Total Cycles</span>
                    <span className={styles.MetaValue}>{d.cycle_count ?? 0}</span>
                  </div>
                  <div className={styles.MetaItem}>
                    <span className={styles.MetaLabel}>PR Reviewed</span>
                    <span className={styles.MetaValue}>{d.pr_reviewed ? 'Yes' : 'No'}</span>
                  </div>
                </div>

                {(() => {
                  const matchedItem = items?.find(i => i.id === d.item_id)
                  const spend = matchedItem?.runtime?.spend as { delegator_usd?: number } | undefined
                  const delegatorSpend = spend?.delegator_usd
                  if (delegatorSpend == null || delegatorSpend <= 0) return null
                  return (
                    <div className={styles.MetaItem}>
                      <span className={styles.MetaLabel}>Delegator Spend</span>
                      <span className={styles.MetaValue}>${delegatorSpend.toFixed(2)}</span>
                    </div>
                  )
                })()}

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

                {d.cycle_log && d.cycle_log.length > 0 && (
                  <div className={styles.Section}>
                    <h4 className={styles.SectionTitle}>Recent Cycles ({d.cycle_log.length})</h4>
                    <div className={styles.ReviewList}>
                      {d.cycle_log.slice(-5).map((entry, i) => (
                        <div key={i} className={styles.ReviewItem}>
                          <span className={styles.CommitHash}>{entry.result}</span>
                          <span className={styles.CommitMsg}>{entry.message || ''}</span>
                          <span className={styles.CommitAssessment}>{timeAgo(entry.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  const triage = parseTriageOutput(d.lastTriageOutput)
                  if (!triage) return null
                  const cls = decisionStyles[triage.decision] || 'decisionMuted'
                  return (
                    <div className={styles.TriageRow}>
                      <span className={styles.TriageLabel}>Decision:</span>
                      <span className={classnames(styles.TriageBadge, styles[cls])}>{triage.decision}</span>
                      {triage.reason && (
                        <>
                          <span className={styles.TriageLabel}>Reason:</span>
                          <span className={styles.TriageReason}>{triage.reason}</span>
                        </>
                      )}
                    </div>
                  )
                })()}

                <CollapsibleJson label="Last Cycle Payload" data={d.lastCyclePayload} />
                <CollapsibleJson label="Last Triage Output" data={d.lastTriageOutput} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

