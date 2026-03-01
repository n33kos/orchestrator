import { useState, useMemo, useEffect, useRef } from 'react'
import classnames from 'classnames'
import styles from './WorkStreamCard.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { BlockerManager } from '../BlockerManager/BlockerManager.tsx'
import { InlineEdit } from '../InlineEdit/InlineEdit.tsx'
import { ActivityLog } from '../ActivityLog/ActivityLog.tsx'
import { MessageComposer } from '../MessageComposer/MessageComposer.tsx'
import { timeAgo, formatDate } from '../../utils/time.ts'
import type { WorkItem, WorkItemStatus, SessionInfo, MessageEntry } from '../../types.ts'

interface WorkStreamCardProps {
  item: WorkItem
  position?: number
  totalCount?: number
  isDragging?: boolean
  isDragOver?: boolean
  selectable?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
  focused?: boolean
  onClearFocus?: () => void
  sessionInfo?: SessionInfo
  messages?: MessageEntry[]
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onPriorityChange: (id: string, priority: number) => void
  onDelegatorToggle: (id: string, enabled: boolean) => void
  onEdit: (id: string, updates: { title?: string; description?: string }) => void
  onAddBlocker: (id: string, description: string) => void
  onResolveBlocker: (id: string, blockerId: string) => void
  onUnresolveBlocker: (id: string, blockerId: string) => void
  onDelete: (id: string) => void
  onDuplicate?: (id: string) => void
  onSendMessage?: (sessionId: string, text: string) => void
  onDragStart?: (id: string) => void
  onDragOver?: (id: string) => void
  onDrop?: (id: string) => void
  onDragEnd?: () => void
}

export function WorkStreamCard({ item, position, totalCount, isDragging, isDragOver, selectable, selected, onSelect, focused, onClearFocus, sessionInfo, messages = [], onStatusChange, onPriorityChange, onDelegatorToggle, onEdit, onAddBlocker, onResolveBlocker, onUnresolveBlocker, onDelete, onDuplicate, onSendMessage, onDragStart, onDragOver, onDrop, onDragEnd }: WorkStreamCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focused) {
      setExpanded(true)
      requestAnimationFrame(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      // Clear focus after a short delay so re-navigation works
      const timer = setTimeout(() => onClearFocus?.(), 1500)
      return () => clearTimeout(timer)
    }
  }, [focused, onClearFocus])
  const hasLiveSession = !!sessionInfo
  const hasSession = !!item.session_id
  const hasDelegator = !!item.delegator_id
  const unresolvedBlockers = item.blockers.filter(b => !b.resolved)
  const implementationNotes = item.metadata.implementation_notes as string[] | undefined
  const notes = item.metadata.notes as string | undefined

  const activityEntries = useMemo(() => {
    const entries: { timestamp: string; action: string; detail?: string }[] = []
    if (item.created_at) entries.push({ timestamp: item.created_at, action: 'Created', detail: `Source: ${item.source}` })
    if (item.activated_at) entries.push({ timestamp: item.activated_at, action: 'Activated' })
    for (const b of item.blockers) {
      entries.push({ timestamp: b.created_at, action: 'Blocker added', detail: b.description })
      if (b.resolved && b.resolved_at) entries.push({ timestamp: b.resolved_at, action: 'Blocker resolved', detail: b.description })
    }
    if (item.completed_at) entries.push({ timestamp: item.completed_at, action: 'Completed' })
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return entries
  }, [item])

  function getQuickAction(): { label: string; status: WorkItemStatus } | null {
    if (item.status === 'queued' || item.status === 'planning') return { label: 'Activate', status: 'active' }
    if (item.status === 'active') return { label: 'Review', status: 'review' }
    if (item.status === 'review') return { label: 'Complete', status: 'completed' }
    if (item.status === 'paused') return { label: 'Resume', status: 'active' }
    return null
  }

  const quickAction = getQuickAction()

  return (
    <div
      ref={cardRef}
      className={classnames(
        styles.Root,
        styles[item.status],
        expanded && styles.expanded,
        selected && styles.selected,
        focused && styles.focused,
        isDragging && styles.dragging,
        isDragOver && styles.dragOver,
      )}
      onClick={() => setExpanded(!expanded)}
      draggable={!expanded}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.id)
        onDragStart?.(item.id)
      }}
      onDragOver={e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver?.(item.id)
      }}
      onDrop={e => {
        e.preventDefault()
        onDrop?.(item.id)
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className={styles.Header}>
        <div className={styles.TitleRow}>
          {selectable && (
            <label className={styles.Checkbox} onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected ?? false}
                onChange={() => onSelect?.(item.id)}
              />
              <span className={styles.CheckboxMark} />
            </label>
          )}
          <span className={styles.DragHandle} title="Drag to reorder" onClick={e => e.stopPropagation()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
            </svg>
          </span>
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
          <div className={styles.MetaLeft}>
            <span className={styles.MetaItem}>
              <span className={styles.MetaLabel}>Branch</span>
              <code className={styles.MetaValue}>{item.branch}</code>
            </span>
            {position != null && totalCount != null && (
              <span className={styles.QueuePosition} title={`Position ${position} of ${totalCount}`}>
                {position}/{totalCount}
              </span>
            )}
            <span className={styles.TimeAgo} title={formatDate(item.activated_at || item.created_at)}>
              {item.activated_at ? `Active ${timeAgo(item.activated_at)}` : `Created ${timeAgo(item.created_at)}`}
            </span>
          </div>
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
            <span
              className={classnames(
                styles.SessionIndicator,
                hasLiveSession && styles[`session_${sessionInfo!.state}`],
                !hasLiveSession && hasSession && styles.session_offline,
              )}
              title={hasLiveSession ? `Session: ${sessionInfo!.state}` : hasSession ? 'Session offline' : 'No session'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              {hasLiveSession && <span className={classnames(styles.SessionDot, styles[sessionInfo!.state])} />}
            </span>
            <span className={classnames(styles.Indicator, hasDelegator && styles.IndicatorActive)} title="Delegator">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <span className={styles.TypeBadge}>{item.type === 'project' ? 'Project' : 'Quick Fix'}</span>
            {quickAction && (
              <button
                className={styles.QuickAction}
                onClick={e => { e.stopPropagation(); onStatusChange(item.id, quickAction.status) }}
                title={quickAction.label}
              >
                {quickAction.label}
              </button>
            )}
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

          {/* Activity Timeline */}
          <div className={styles.Section}>
            <h4 className={styles.SectionTitle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Activity
            </h4>
            <ActivityLog entries={activityEntries} />
          </div>

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
            <span className={classnames(styles.StatusItem, hasLiveSession && styles.StatusActive)}>
              <span className={classnames(styles.LiveDot, hasLiveSession && styles[sessionInfo!.state])} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Worker: {hasLiveSession ? `${sessionInfo!.state} (${sessionInfo!.id.slice(0, 8)})` : hasSession ? item.session_id : 'Not running'}
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

          {/* Session Messaging */}
          {hasLiveSession && onSendMessage && (
            <div className={styles.Section}>
              <h4 className={styles.SectionTitle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                Session Messaging
              </h4>
              <MessageComposer
                sessionId={sessionInfo!.id}
                sessionState={sessionInfo!.state}
                messages={messages}
                onSend={text => onSendMessage(sessionInfo!.id, text)}
              />
            </div>
          )}

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
              {(item.status === 'queued' || item.status === 'planning') && (
                <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'active')}>
                  Activate
                </button>
              )}
              {item.status === 'active' && (
                <>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'review')}>
                    Move to Review
                  </button>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'paused')}>
                    Pause
                  </button>
                </>
              )}
              {item.status === 'review' && (
                <>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'completed')}>
                    Complete
                  </button>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'active')}>
                    Back to Active
                  </button>
                </>
              )}
              {item.status === 'paused' && (
                <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'active')}>
                  Resume
                </button>
              )}
              {onDuplicate && (
                <button
                  className={styles.ActionButtonText}
                  onClick={() => onDuplicate(item.id)}
                >
                  Duplicate
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
