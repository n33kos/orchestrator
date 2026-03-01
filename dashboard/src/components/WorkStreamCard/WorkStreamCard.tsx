import { useState } from 'react'
import classnames from 'classnames'
import styles from './WorkStreamCard.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { BlockerManager } from '../BlockerManager/BlockerManager.tsx'
import { InlineEdit } from '../InlineEdit/InlineEdit.tsx'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface WorkStreamCardProps {
  item: WorkItem
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onPriorityChange: (id: string, priority: number) => void
  onDelegatorToggle: (id: string, enabled: boolean) => void
  onEdit: (id: string, updates: { title?: string; description?: string }) => void
  onAddBlocker: (id: string, description: string) => void
  onResolveBlocker: (id: string, blockerId: string) => void
  onUnresolveBlocker: (id: string, blockerId: string) => void
  onDelete: (id: string) => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function WorkStreamCard({ item, onStatusChange, onPriorityChange, onDelegatorToggle, onEdit, onAddBlocker, onResolveBlocker, onUnresolveBlocker, onDelete }: WorkStreamCardProps) {
  const [expanded, setExpanded] = useState(false)
  const hasSession = !!item.session_id
  const hasDelegator = !!item.delegator_id
  const unresolvedBlockers = item.blockers.filter(b => !b.resolved)
  const resolvedBlockers = item.blockers.filter(b => b.resolved)
  const implementationNotes = item.metadata.implementation_notes as string[] | undefined
  const notes = item.metadata.notes as string | undefined

  return (
    <div
      className={classnames(styles.Root, styles[item.status], expanded && styles.expanded)}
      onClick={() => setExpanded(!expanded)}
    >
      <div className={styles.Header}>
        <div className={styles.TitleRow}>
          <span className={styles.Priority}>#{item.priority}</span>
          {expanded ? (
            <InlineEdit
              value={item.title}
              onSave={title => onEdit(item.id, { title })}
              className={styles.Title}
            />
          ) : (
            <h3 className={styles.Title}>{item.title}</h3>
          )}
          {unresolvedBlockers.length > 0 && (
            <span className={styles.BlockerBadge} title={`${unresolvedBlockers.length} blocker(s)`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              {unresolvedBlockers.length}
            </span>
          )}
        </div>
        <div className={styles.HeaderRight}>
          <StatusBadge status={item.status} />
          <span className={classnames(styles.Chevron, expanded && styles.ChevronOpen)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      {expanded ? (
        <InlineEdit
          value={item.description}
          onSave={description => onEdit(item.id, { description })}
          className={classnames(styles.Description, styles.DescriptionExpanded)}
          multiline
        />
      ) : (
        <p className={styles.Description}>
          {item.description}
        </p>
      )}

      {!expanded && (
        <div className={styles.Meta}>
          <span className={styles.MetaItem}>
            <span className={styles.MetaLabel}>Branch</span>
            <code className={styles.MetaValue}>{item.branch}</code>
          </span>
          <div className={styles.Indicators}>
            {item.pr_url && (
              <a
                className={styles.PrLink}
                href={item.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title="Open PR"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M6 21V9a9 9 0 009 9" />
                </svg>
                PR
              </a>
            )}
            <span className={classnames(styles.Indicator, hasSession && styles.IndicatorActive)} title="Worker session">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
            <span className={classnames(styles.Indicator, hasDelegator && styles.IndicatorActive)} title="Delegator">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <span className={styles.TypeBadge}>{item.type === 'project' ? 'Project' : 'Quick Fix'}</span>
          </div>
        </div>
      )}

      {expanded && (
        <div className={styles.Details}>
          {/* Blockers Section */}
          <div className={styles.Section}>
            <h4 className={styles.SectionTitle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              Blockers
              {unresolvedBlockers.length > 0 && (
                <span className={styles.SectionCount}>{unresolvedBlockers.length}</span>
              )}
            </h4>
            <BlockerManager
              blockers={item.blockers}
              onAddBlocker={desc => onAddBlocker(item.id, desc)}
              onResolveBlocker={bid => onResolveBlocker(item.id, bid)}
              onUnresolveBlocker={bid => onUnresolveBlocker(item.id, bid)}
            />
          </div>

          {/* Implementation Notes */}
          {implementationNotes && implementationNotes.length > 0 && (
            <div className={styles.Section}>
              <h4 className={styles.SectionTitle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Implementation Notes
              </h4>
              <ul className={styles.NotesList}>
                {implementationNotes.map((note, i) => (
                  <li key={i} className={styles.Note}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes */}
          {notes && (
            <div className={styles.Section}>
              <h4 className={styles.SectionTitle}>Notes</h4>
              <p className={styles.NotesText}>{notes}</p>
            </div>
          )}

          {/* Metadata Grid */}
          <div className={styles.MetaGrid}>
            <div className={styles.MetaGridItem}>
              <span className={styles.MetaGridLabel}>Branch</span>
              <code className={styles.MetaGridValue}>{item.branch}</code>
            </div>
            <div className={styles.MetaGridItem}>
              <span className={styles.MetaGridLabel}>Type</span>
              <span className={styles.MetaGridValue}>{item.type === 'project' ? 'Project' : 'Quick Fix'}</span>
            </div>
            <div className={styles.MetaGridItem}>
              <span className={styles.MetaGridLabel}>Source</span>
              <span className={styles.MetaGridValue}>{item.source}</span>
            </div>
            <div className={styles.MetaGridItem}>
              <span className={styles.MetaGridLabel}>Created</span>
              <span className={styles.MetaGridValue}>{formatDate(item.created_at)}</span>
            </div>
            <div className={styles.MetaGridItem}>
              <span className={styles.MetaGridLabel}>Activated</span>
              <span className={styles.MetaGridValue}>{formatDate(item.activated_at)}</span>
            </div>
            <div className={styles.MetaGridItem}>
              <span className={styles.MetaGridLabel}>Completed</span>
              <span className={styles.MetaGridValue}>{formatDate(item.completed_at)}</span>
            </div>
            {item.pr_url && (
              <div className={classnames(styles.MetaGridItem, styles.MetaGridWide)}>
                <span className={styles.MetaGridLabel}>Pull Request</span>
                <a
                  className={styles.MetaGridLink}
                  href={item.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  {item.pr_url}
                </a>
              </div>
            )}
            {item.worktree_path && (
              <div className={classnames(styles.MetaGridItem, styles.MetaGridWide)}>
                <span className={styles.MetaGridLabel}>Worktree</span>
                <code className={styles.MetaGridValue}>{item.worktree_path}</code>
              </div>
            )}
          </div>

          {/* Session/Delegator Status */}
          <div className={styles.StatusRow}>
            <span className={classnames(styles.StatusItem, hasSession && styles.StatusActive)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Worker: {hasSession ? item.session_id : 'Not running'}
            </span>
            <label
              className={classnames(styles.StatusItem, styles.DelegatorToggle)}
              onClick={e => e.stopPropagation()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Delegator
              <button
                className={classnames(styles.Toggle, item.delegator_enabled && styles.ToggleOn)}
                onClick={() => onDelegatorToggle(item.id, !item.delegator_enabled)}
                role="switch"
                aria-checked={item.delegator_enabled}
              >
                <span className={styles.ToggleKnob} />
              </button>
              <span className={styles.ToggleLabel}>
                {hasDelegator ? 'Active' : item.delegator_enabled ? 'Enabled' : 'Off'}
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className={styles.ActionBar} onClick={e => e.stopPropagation()}>
            <div className={styles.PriorityActions}>
              <button
                className={styles.ActionButton}
                onClick={() => onPriorityChange(item.id, Math.max(1, item.priority - 1))}
                title="Increase priority"
                disabled={item.priority <= 1}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <span className={styles.PriorityLabel}>Priority {item.priority}</span>
              <button
                className={styles.ActionButton}
                onClick={() => onPriorityChange(item.id, item.priority + 1)}
                title="Decrease priority"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            <div className={styles.StatusActions}>
              {item.status === 'active' && (
                <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'paused')}>
                  Pause
                </button>
              )}
              {item.status === 'paused' && (
                <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'active')}>
                  Resume
                </button>
              )}
              {item.status === 'queued' && (
                <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'active')}>
                  Activate
                </button>
              )}
              {(item.status === 'active' || item.status === 'review') && (
                <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'completed')}>
                  Complete
                </button>
              )}
              <button
                className={classnames(styles.ActionButtonText, styles.ActionDanger)}
                onClick={() => onDelete(item.id)}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
