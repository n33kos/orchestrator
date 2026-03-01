import styles from './WorkStreamList.module.scss'
import { WorkStreamCard } from '../WorkStreamCard/WorkStreamCard.tsx'
import { SkeletonList } from '../Skeleton/Skeleton.tsx'
import { useDragReorder } from '../../hooks/useDragReorder.ts'
import type { Plan } from '../PlanEditor/PlanEditor.tsx'
import type { WorkItem, WorkItemStatus, SessionInfo, MessageEntry } from '../../types.ts'
import type { SortField, SortDirection } from '../SortControls/SortControls.tsx'

interface WorkStreamListProps {
  items: WorkItem[]
  loading: boolean
  hasSearch: boolean
  emptyLabel?: string
  emptyTab?: string
  sortField: SortField
  sortDirection: SortDirection
  sessions: SessionInfo[]
  messagesBySession: Record<string, MessageEntry[]>
  selectable?: boolean
  selectedIds?: Set<string>
  onSelect?: (id: string) => void
  focusedItemId?: string | null
  onClearFocus?: () => void
  pinnedIds?: Set<string>
  onTogglePin?: (id: string) => void
  onAddClick?: () => void
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
  activatingIds?: Set<string>
  tearingDownIds?: Set<string>
  onPrUrlChange?: (id: string, prUrl: string) => void
  onPlanChange?: (id: string, plan: Plan) => void
  onReorder: (dragId: string, dropId: string) => void
  onSendMessage: (sessionId: string, text: string) => void
}

function findSession(sessions: SessionInfo[], item: WorkItem): SessionInfo | undefined {
  if (item.session_id) {
    const byId = sessions.find(s => s.id === item.session_id)
    if (byId) return byId
  }
  if (item.worktree_path) {
    return sessions.find(s => s.cwd === item.worktree_path || item.worktree_path!.startsWith(s.cwd))
  }
  return undefined
}

export function WorkStreamList({ items, loading, hasSearch, emptyLabel, emptyTab, sortField, sortDirection, sessions, messagesBySession, selectable, selectedIds, onSelect, focusedItemId, onClearFocus, pinnedIds, onTogglePin, onAddClick, onStatusChange, onPriorityChange, onDelegatorToggle, onEdit, onAddBlocker, onResolveBlocker, onUnresolveBlocker, onDelete, onDuplicate, onActivateStream, onTeardownStream, activatingIds, tearingDownIds, onPrUrlChange, onPlanChange, onReorder, onSendMessage }: WorkStreamListProps) {
  const { dragId, overId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } = useDragReorder(onReorder)
  if (loading) {
    return <SkeletonList count={4} />
  }

  if (items.length === 0) {
    if (hasSearch) {
      return (
        <div className={styles.Root}>
          <div className={styles.Empty}>
            <div className={styles.EmptyIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className={styles.EmptyText}>No matching work streams</p>
            <p className={styles.EmptySubtext}>
              Try adjusting your search query or clearing the filter.
            </p>
          </div>
        </div>
      )
    }

    const emptyConfig = {
      projects: {
        icon: (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        ),
        title: 'No projects',
        description: 'Projects are larger work items that get their own worktree, Claude session, and optional delegator. Add one manually or configure a source to discover them.',
        hints: [
          { label: 'Add a project', desc: 'Press N or click the + button to create one' },
          { label: 'Configure sources', desc: 'Set up Jira, GitHub Issues, or Slack as work sources' },
        ],
      },
      quick_fixes: {
        icon: (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        ),
        title: 'No quick fixes',
        description: 'Quick fixes are small, fast tasks that bypass concurrency limits and skip the delegator. They are ideal for one-off bug fixes or minor changes.',
        hints: [
          { label: 'Add a quick fix', desc: 'Press N, then select "Quick Fix" as the type' },
        ],
      },
      all: {
        icon: (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
          </svg>
        ),
        title: 'No work streams yet',
        description: 'Your queue is empty. Work items will appear here once you add them manually or configure automated discovery from sources like Jira, GitHub, or Slack.',
        hints: [
          { label: 'Add your first item', desc: 'Press N or click + to get started' },
          { label: 'Open command palette', desc: 'Press Cmd+K for quick actions' },
          { label: 'Configure settings', desc: 'Set concurrency limits, polling intervals, and automation' },
        ],
      },
    }

    const config = emptyConfig[emptyTab as keyof typeof emptyConfig] ?? emptyConfig.all

    return (
      <div className={styles.Root}>
        <div className={styles.Empty}>
          <div className={styles.EmptyIcon}>{config.icon}</div>
          <p className={styles.EmptyText}>{emptyLabel || config.title}</p>
          <p className={styles.EmptySubtext}>{config.description}</p>
          {config.hints.length > 0 && (
            <div className={styles.EmptyHints}>
              {config.hints.map((hint, i) => (
                <div key={i} className={styles.EmptyHint}>
                  <span className={styles.HintLabel}>{hint.label}</span>
                  <span className={styles.HintDesc}>{hint.desc}</span>
                </div>
              ))}
            </div>
          )}
          {onAddClick && (
            <button className={styles.EmptyAddButton} onClick={onAddClick}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Work Item
            </button>
          )}
        </div>
      </div>
    )
  }

  const statusOrder: Record<string, number> = {
    active: 0,
    review: 1,
    queued: 2,
    planning: 3,
    paused: 4,
    completed: 5,
  }

  const dir = sortDirection === 'asc' ? 1 : -1

  const sorted = [...items].sort((a, b) => {
    // Pinned items always come first
    const aPinned = pinnedIds?.has(a.id) ? 1 : 0
    const bPinned = pinnedIds?.has(b.id) ? 1 : 0
    if (aPinned !== bPinned) return bPinned - aPinned

    switch (sortField) {
      case 'status': {
        const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        if (statusDiff !== 0) return statusDiff * dir
        return (a.priority - b.priority) * dir
      }
      case 'created': {
        const da = new Date(a.created_at).getTime()
        const db = new Date(b.created_at).getTime()
        return (da - db) * dir
      }
      case 'title':
        return a.title.localeCompare(b.title) * dir
      case 'priority':
      default: {
        const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        if (statusDiff !== 0) return statusDiff
        return (a.priority - b.priority) * dir
      }
    }
  })

  return (
    <div className={styles.Root}>
      {sorted.map((item, i) => {
        const session = findSession(sessions, item)
        return (
          <WorkStreamCard
            key={item.id}
            item={item}
            index={i}
            position={i + 1}
            totalCount={sorted.length}
            isDragging={dragId === item.id}
            isDragOver={overId === item.id}
            selectable={selectable}
            selected={selectedIds?.has(item.id)}
            onSelect={onSelect}
            focused={focusedItemId === item.id}
            onClearFocus={onClearFocus}
            pinned={pinnedIds?.has(item.id)}
            onTogglePin={onTogglePin}
            sessionInfo={session}
            messages={session ? messagesBySession[session.id] ?? [] : []}
            onStatusChange={onStatusChange}
            onPriorityChange={onPriorityChange}
            onDelegatorToggle={onDelegatorToggle}
            onEdit={onEdit}
            onAddBlocker={onAddBlocker}
            onResolveBlocker={onResolveBlocker}
            onUnresolveBlocker={onUnresolveBlocker}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onActivateStream={onActivateStream}
            onTeardownStream={onTeardownStream}
            activating={activatingIds?.has(item.id)}
            tearingDown={tearingDownIds?.has(item.id)}
            onPrUrlChange={onPrUrlChange}
            onPlanChange={onPlanChange}
            onSendMessage={onSendMessage}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        )
      })}
    </div>
  )
}
