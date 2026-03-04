import { useState, useEffect, useRef } from 'react'
import classnames from 'classnames'
import styles from './WorkStreamCard.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { InlineEdit } from '../InlineEdit/InlineEdit.tsx'
import { ContextMenu } from '../ContextMenu/ContextMenu.tsx'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu.tsx'
import { ItemDetails } from '../ItemDetails/ItemDetails.tsx'
import { timeAgo, formatDate } from '../../utils/time.ts'
import { useTimeRefresh } from '../../hooks/useTimeRefresh.ts'
import { ProgressBar } from '../ProgressBar/ProgressBar.tsx'
import { usePrStack } from '../../hooks/usePrStatus.ts'
import type { WorkItem, WorkItemStatus, SessionInfo, MessageEntry, StackStep } from '../../types.ts'

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

export function WorkStreamCard({ item, index = 0, position, totalCount, isDragging, isDragOver, selectable, selected, onSelect, focused, onClearFocus, pinned, onTogglePin, sessionInfo, messages = [], onStatusChange, onPriorityChange, onDelegatorToggle, onEdit, onDelete, onDuplicate, onActivateStream, onTeardownStream, onPrUrlChange, onGeneratePlan, activating, tearingDown, onSendMessage, onDragStart, onDragOver, onDrop, onDragEnd }: WorkStreamCardProps) {
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
  const hasDelegator = item.delegator_enabled
  const hasBlockingDeps = item.blocked_by.length > 0
  const isStack = item.metadata?.pr_type === 'graphite_stack'
  const stackSteps = (item.metadata?.stack_steps as StackStep[] | undefined) ?? []
  const stackCompletedCount = stackSteps.filter(s => s.completed).length
  const { stack: prStack } = usePrStack(expanded ? item.pr_url : null, isStack)
  const itemPlan = item.metadata.plan as { summary?: string; approved?: boolean } | undefined
  const itemPlanFile = item.metadata.plan_file as string | undefined

  const isBusy = activating || tearingDown

  function getQuickAction(): { label: string; status: WorkItemStatus; useStream?: boolean; expandOnly?: boolean } | null {
    if (activating) return { label: 'Activating...', status: 'active' }
    if (tearingDown) return { label: 'Tearing down...', status: 'completed' }
    if (item.status === 'queued') return { label: 'Plan', status: 'planning' }
    if (item.status === 'planning') {
      const planApproved = itemPlan?.approved
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
          {hasBlockingDeps && (
            <span className={styles.DepBadge} title={`Blocked by: ${item.blocked_by.join(', ')}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              {item.blocked_by.length}
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
            {(() => {
              const spendUsd = (item.metadata.spend as { total_usd?: number } | undefined)?.total_usd
              return spendUsd != null && spendUsd > 0 ? (
                <span
                  className={classnames(
                    styles.SpendBadge,
                    spendUsd < 5 && styles.SpendGreen,
                    spendUsd >= 5 && spendUsd <= 20 && styles.SpendYellow,
                    spendUsd > 20 && styles.SpendRed,
                  )}
                  title={`Token spend: $${spendUsd.toFixed(2)}`}
                >
                  ${spendUsd.toFixed(2)}
                </span>
              ) : null
            })()}
            {isStack && stackSteps.length > 0 && (
              <span
                className={styles.StackProgress}
                title={`Stack: ${stackCompletedCount}/${stackSteps.length} steps complete`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                {stackCompletedCount}/{stackSteps.length}
              </span>
            )}
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
                  itemPlan?.approved ? styles.PlanApproved : styles.PlanDraft,
                )}
                title={itemPlan?.approved ? 'Plan approved' : 'Plan draft — needs review'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                </svg>
                {itemPlan?.approved ? '' : '!'}
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
        <ItemDetails
          item={item}
          variant="inline"
          sessionInfo={sessionInfo}
          messages={messages}
          onStatusChange={onStatusChange}
          onPriorityChange={onPriorityChange}
          onDelegatorToggle={onDelegatorToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onActivateStream={onActivateStream}
          onTeardownStream={onTeardownStream}
          onPrUrlChange={onPrUrlChange}
          onGeneratePlan={onGeneratePlan}
          onSendMessage={onSendMessage}
          activating={activating}
          tearingDown={tearingDown}
        />
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
