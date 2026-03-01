import { useState, useMemo, useEffect, useRef } from 'react'
import classnames from 'classnames'
import styles from './WorkStreamCard.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { BlockerManager } from '../BlockerManager/BlockerManager.tsx'
import { InlineEdit } from '../InlineEdit/InlineEdit.tsx'
import { ActivityLog } from '../ActivityLog/ActivityLog.tsx'
import { MessageComposer } from '../MessageComposer/MessageComposer.tsx'
import { ContextMenu } from '../ContextMenu/ContextMenu.tsx'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu.tsx'
import { timeAgo, formatDate } from '../../utils/time.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import { ProgressBar } from '../ProgressBar/ProgressBar.tsx'
import { usePrStatus, usePrStack } from '../../hooks/usePrStatus.ts'
import type { StackPr } from '../../hooks/usePrStatus.ts'
import type { WorkItem, WorkItemStatus, SessionInfo, MessageEntry } from '../../types.ts'

interface WorkStreamCardProps {
  item: WorkItem
  index?: number
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
  onActivateStream?: (id: string) => void
  onTeardownStream?: (id: string) => void
  onPrUrlChange?: (id: string, prUrl: string) => void
  onGeneratePlan?: (id: string) => void
  activating?: boolean
  tearingDown?: boolean
  pinned?: boolean
  onTogglePin?: (id: string) => void
  onSendMessage?: (sessionId: string, text: string) => void
  onDragStart?: (id: string) => void
  onDragOver?: (id: string) => void
  onDrop?: (id: string) => void
  onDragEnd?: () => void
}

export function WorkStreamCard({ item, index = 0, position, totalCount, isDragging, isDragOver, selectable, selected, onSelect, focused, onClearFocus, pinned, onTogglePin, sessionInfo, messages = [], onStatusChange, onPriorityChange, onDelegatorToggle, onEdit, onAddBlocker, onResolveBlocker, onUnresolveBlocker, onDelete, onDuplicate, onActivateStream, onTeardownStream, onPrUrlChange, onGeneratePlan, activating, tearingDown, onSendMessage, onDragStart, onDragOver, onDrop, onDragEnd }: WorkStreamCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  useTimeRefresh(60_000)

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
  const { status: prStatus, loading: prLoading } = usePrStatus(expanded ? item.pr_url : null)
  const isStack = item.metadata?.pr_type === 'graphite_stack'
  const { stack: prStack, loading: stackLoading } = usePrStack(expanded ? item.pr_url : null, isStack)
  const delegatorAssessment = item.metadata.delegator_assessment as string | undefined
  const itemPlan = item.metadata.plan as { summary?: string; approved?: boolean } | undefined
  const itemPlanFile = item.metadata.plan_file as string | undefined

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

  const isBusy = activating || tearingDown

  function getQuickAction(): { label: string; status: WorkItemStatus; useStream?: boolean; expandOnly?: boolean } | null {
    if (activating) return { label: 'Activating...', status: 'active' }
    if (tearingDown) return { label: 'Tearing down...', status: 'completed' }
    if (item.status === 'queued') return { label: 'Plan', status: 'planning' }
    if (item.status === 'planning') {
      const planApproved = item.metadata?.plan_approved
      if (planApproved) return { label: 'Activate', status: 'active', useStream: !!onActivateStream }
      return itemPlanFile
        ? { label: 'Review Plan', status: 'planning', expandOnly: true }
        : { label: 'Write Plan', status: 'planning', expandOnly: true }
    }
    if (item.status === 'active') return { label: 'Review', status: 'review' }
    if (item.status === 'review') return { label: 'Complete', status: 'completed' }
    if (item.status === 'paused') return { label: 'Resume', status: 'active', useStream: !!onActivateStream }
    return null
  }

  const quickAction = getQuickAction()

  function handleQuickAction() {
    if (isBusy || !quickAction) return
    if (quickAction.expandOnly) {
      setExpanded(true)
      return
    }
    if (quickAction.useStream && onActivateStream) {
      onActivateStream(item.id)
    } else {
      onStatusChange(item.id, quickAction.status)
    }
  }

  function buildContextMenuItems(): ContextMenuItem[] {
    const items: ContextMenuItem[] = []
    if (quickAction && !isBusy) {
      items.push({
        id: 'quick-action',
        label: quickAction.label,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>,
        action: handleQuickAction,
      })
    }
    if (onTeardownStream && (item.status === 'active' || item.status === 'review') && (item.worktree_path || item.session_id) && !isBusy) {
      items.push({
        id: 'teardown',
        label: 'Tear Down',
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></svg>,
        danger: true,
        action: () => onTeardownStream(item.id),
      })
    }
    items.push({
      id: 'sep-1', label: '', separator: true, action: () => {},
    })
    if (item.status === 'active') {
      items.push({
        id: 'pause',
        label: 'Pause',
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>,
        action: () => onStatusChange(item.id, 'paused'),
      })
    }
    if (onDuplicate) {
      items.push({
        id: 'duplicate',
        label: 'Duplicate',
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>,
        action: () => onDuplicate(item.id),
      })
    }
    if (item.branch) {
      items.push({
        id: 'copy-branch',
        label: 'Copy branch name',
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>,
        action: () => navigator.clipboard.writeText(item.branch),
      })
    }
    if (onTogglePin) {
      items.push({
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin to top',
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M12 2l2.09 6.26L21 9.27l-5 3.9L17.18 22 12 18.27 6.82 22 8 13.17l-5-3.9 6.91-1.01z" /></svg>,
        action: () => onTogglePin(item.id),
      })
    }
    items.push({
      id: 'sep-2', label: '', separator: true, action: () => {},
    })
    items.push({
      id: 'delete',
      label: 'Remove',
      danger: true,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>,
      action: () => onDelete(item.id),
    })
    return items
  }

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
      style={{ '--index': index } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${item.title} — ${item.status}, priority ${item.priority}`}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setExpanded(!expanded)
        }
      }}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
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
          {onTogglePin && (
            <button
              className={classnames(styles.PinButton, pinned && styles.PinButtonActive)}
              onClick={e => { e.stopPropagation(); onTogglePin(item.id) }}
              aria-label={pinned ? 'Unpin' : 'Pin to top'}
              aria-pressed={pinned}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M12 2l2.09 6.26L21 9.27l-5 3.9L17.18 22 12 18.27 6.82 22 8 13.17l-5-3.9 6.91-1.01z" />
              </svg>
            </button>
          )}
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
                href={isStack && prStack?.graphiteStackUrl ? prStack.graphiteStackUrl : item.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title={isStack ? 'Open Graphite stack' : 'Open PR'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M6 21V9a9 9 0 009 9" />
                </svg>
                {isStack ? `Stack (${prStack?.prs.length ?? '...'})` : 'PR'}
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
            {itemPlanFile && (
              <span
                className={classnames(
                  styles.PlanIndicator,
                  item.metadata?.plan_approved ? styles.PlanApproved : styles.PlanDraft,
                )}
                title={item.metadata?.plan_approved ? 'Plan approved' : 'Plan draft — needs review'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                </svg>
                {item.metadata?.plan_approved ? '' : '!'}
              </span>
            )}
            <span className={classnames(styles.Indicator, hasDelegator && styles.IndicatorActive)} title="Delegator">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <span className={styles.TypeBadge}>{item.type === 'project' ? 'Project' : 'Quick Fix'}</span>
            {quickAction && (
              <button
                className={classnames(styles.QuickAction, isBusy && styles.QuickActionBusy)}
                onClick={e => { e.stopPropagation(); handleQuickAction() }}
                title={quickAction.label}
                disabled={isBusy}
              >
                {quickAction.label}
              </button>
            )}
          </div>
        </div>
      )}

      {!expanded && (
        <ProgressBar status={item.status} />
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

          {/* Implementation Plan */}
          {itemPlanFile && (
            <div className={styles.Section}>
              <h4 className={styles.SectionTitle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                  <line x1="9" y1="12" x2="15" y2="12" />
                  <line x1="9" y1="16" x2="15" y2="16" />
                </svg>
                Plan: {itemPlanFile.split('/').pop()}
                {item.metadata?.plan_approved ? ' (Approved)' : ' (Draft)'}
              </h4>
              {itemPlan?.summary && <p className={styles.NotesText}>{itemPlan.summary}</p>}
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

          {/* Pull Request Section */}
          <div className={styles.Section}>
            <h4 className={styles.SectionTitle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M6 21V9a9 9 0 009 9" />
              </svg>
              {isStack ? 'PR Stack (Graphite)' : 'Pull Request'}
            </h4>
            {item.pr_url ? (
              <div className={styles.PrSection} onClick={e => e.stopPropagation()}>
                {/* Graphite stack view */}
                {isStack && prStack ? (
                  <>
                    {prStack.graphiteStackUrl && (
                      <a
                        className={styles.PrLink}
                        href={prStack.graphiteStackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View full stack on Graphite
                      </a>
                    )}
                    <div className={styles.StackList}>
                      {prStack.prs.map((pr: StackPr) => (
                        <div key={pr.number} className={styles.StackItem}>
                          <div className={styles.StackItemHeader}>
                            <a
                              className={styles.StackPrLink}
                              href={pr.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              #{pr.number}
                            </a>
                            <span className={styles.StackPrTitle}>{pr.title}</span>
                            <span className={classnames(styles.PrBadge, styles[`pr_${pr.state.toLowerCase()}`])}>
                              {pr.state}
                            </span>
                          </div>
                          <div className={styles.StackItemMeta}>
                            {pr.reviewDecision && (
                              <span className={classnames(styles.PrBadge, styles[`pr_review_${pr.reviewDecision.toLowerCase()}`])}>
                                {pr.reviewDecision === 'APPROVED' ? 'Approved' :
                                 pr.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes Req.' :
                                 'Review Req.'}
                              </span>
                            )}
                            <span className={classnames(
                              styles.PrBadge,
                              pr.checksPass && styles.pr_checks_pass,
                              pr.checksFail && styles.pr_checks_fail,
                              !pr.checksPass && !pr.checksFail && styles.pr_checks_pending,
                            )}>
                              {pr.checksPass ? 'Checks Pass' : pr.checksFail ? 'Checks Fail' : 'Pending'}
                            </span>
                            <span className={styles.PrStats}>
                              <span className={styles.PrAdditions}>+{pr.additions}</span>
                              <span className={styles.PrDeletions}>-{pr.deletions}</span>
                              <span className={styles.PrFiles}>{pr.changedFiles}f</span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {stackLoading && <span className={styles.PrLoading}>Loading stack...</span>}
                  </>
                ) : (
                  /* Single PR view */
                  <>
                    <div className={styles.PrHeader}>
                      <a
                        className={styles.PrLink}
                        href={item.pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.pr_url.replace(/^https?:\/\/github\.com\//, '')}
                      </a>
                      {prLoading && <span className={styles.PrLoading}>Loading...</span>}
                    </div>
                    {prStatus && prStatus.state !== 'unknown' && (
                      <div className={styles.PrStatusGrid}>
                        <span className={classnames(styles.PrBadge, styles[`pr_${prStatus.state.toLowerCase()}`])}>
                          {prStatus.state}
                        </span>
                        {prStatus.reviewDecision && (
                          <span className={classnames(styles.PrBadge, styles[`pr_review_${prStatus.reviewDecision.toLowerCase()}`])}>
                            {prStatus.reviewDecision === 'APPROVED' ? 'Approved' :
                             prStatus.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes Requested' :
                             'Review Required'}
                          </span>
                        )}
                        {prStatus.checksTotal > 0 && (
                          <span className={classnames(
                            styles.PrBadge,
                            prStatus.checksPass && styles.pr_checks_pass,
                            prStatus.checksFail && styles.pr_checks_fail,
                            prStatus.checksPending && styles.pr_checks_pending,
                          )}>
                            Checks: {prStatus.checksPass ? 'Pass' : prStatus.checksFail ? 'Fail' : 'Pending'}
                          </span>
                        )}
                        <span className={styles.PrStats}>
                          <span className={styles.PrAdditions}>+{prStatus.additions}</span>
                          <span className={styles.PrDeletions}>-{prStatus.deletions}</span>
                          <span className={styles.PrFiles}>{prStatus.changedFiles} file{prStatus.changedFiles !== 1 ? 's' : ''}</span>
                        </span>
                      </div>
                    )}
                    {prStatus?.reviews && prStatus.reviews.length > 0 && (
                      <div className={styles.PrReviewers}>
                        {prStatus.reviews.map((r, i) => (
                          <span key={i} className={classnames(styles.PrReviewer, styles[`pr_reviewer_${r.state.toLowerCase()}`])}>
                            {r.author}
                            {r.state === 'APPROVED' && ' ✓'}
                            {r.state === 'CHANGES_REQUESTED' && ' ✗'}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : onPrUrlChange ? (
              <div className={styles.PrEmpty} onClick={e => e.stopPropagation()}>
                <InlineEdit
                  value=""
                  onSave={url => onPrUrlChange(item.id, url)}
                  className={styles.PrUrlInput}
                  placeholder="Paste PR URL..."
                />
              </div>
            ) : (
              <span className={styles.PrNone}>No PR linked</span>
            )}
          </div>

          {/* Delegator Assessment */}
          {delegatorAssessment && (
            <div className={styles.Section}>
              <h4 className={styles.SectionTitle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Delegator Assessment
              </h4>
              <p className={styles.AssessmentText}>{delegatorAssessment}</p>
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
                aria-label="Increase priority"
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
                aria-label="Decrease priority"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            <div className={styles.StatusActions}>
              {item.status === 'queued' && (
                <button
                  className={styles.ActionButtonText}
                  onClick={() => onStatusChange(item.id, 'planning')}
                  disabled={isBusy}
                >
                  Start Planning
                </button>
              )}
              {item.status === 'planning' && item.metadata?.plan_approved && (
                <button
                  className={classnames(styles.ActionButtonText, onActivateStream && styles.ActionPrimary)}
                  onClick={() => onActivateStream ? onActivateStream(item.id) : onStatusChange(item.id, 'active')}
                  disabled={isBusy}
                >
                  {activating ? 'Activating...' : onActivateStream ? 'Activate Stream' : 'Activate'}
                </button>
              )}
              {item.status === 'planning' && !item.metadata?.plan_approved && item.type === 'quick_fix' && (
                <button
                  className={styles.ActionButtonText}
                  onClick={() => onActivateStream ? onActivateStream(item.id) : onStatusChange(item.id, 'active')}
                  disabled={isBusy}
                >
                  {activating ? 'Activating...' : 'Skip Plan & Activate'}
                </button>
              )}
              {item.status === 'planning' && !item.metadata?.plan_approved && (
                <button
                  className={styles.ActionButtonText}
                  onClick={() => onStatusChange(item.id, 'queued')}
                  disabled={isBusy}
                >
                  Back to Queue
                </button>
              )}
              {item.status === 'active' && (
                <>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'review')} disabled={isBusy}>
                    Move to Review
                  </button>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'paused')} disabled={isBusy}>
                    Pause
                  </button>
                </>
              )}
              {item.status === 'review' && (
                <>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'completed')} disabled={isBusy}>
                    Complete
                  </button>
                  <button className={styles.ActionButtonText} onClick={() => onStatusChange(item.id, 'active')} disabled={isBusy}>
                    Back to Active
                  </button>
                </>
              )}
              {item.status === 'paused' && (
                <button
                  className={classnames(styles.ActionButtonText, onActivateStream && styles.ActionPrimary)}
                  onClick={() => onActivateStream ? onActivateStream(item.id) : onStatusChange(item.id, 'active')}
                  disabled={isBusy}
                >
                  {activating ? 'Activating...' : 'Resume'}
                </button>
              )}
              {onTeardownStream && (item.status === 'active' || item.status === 'review') && (item.worktree_path || item.session_id) && (
                <button
                  className={classnames(styles.ActionButtonText, styles.ActionDanger)}
                  onClick={() => onTeardownStream(item.id)}
                  disabled={isBusy}
                >
                  {tearingDown ? 'Tearing down...' : 'Tear Down'}
                </button>
              )}
              {onDuplicate && (
                <button
                  className={styles.ActionButtonText}
                  onClick={() => onDuplicate(item.id)}
                  disabled={isBusy}
                >
                  Duplicate
                </button>
              )}
              <button
                className={classnames(styles.ActionButtonText, styles.ActionDanger)}
                onClick={() => onDelete(item.id)}
                disabled={isBusy}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
