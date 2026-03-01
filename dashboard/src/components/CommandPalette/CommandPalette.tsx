import { useState, useEffect, useRef, useMemo } from 'react'
import classnames from 'classnames'
import styles from './CommandPalette.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface Command {
  id: string
  label: string
  description?: string
  icon: 'search' | 'add' | 'settings' | 'refresh' | 'status' | 'theme' | 'message' | 'monitor' | 'view' | 'health' | 'discover' | 'scheduler' | 'training'
  action: () => void
}

export interface SessionRef {
  itemId: string
  itemTitle: string
  sessionId: string
}

interface CommandPaletteProps {
  items: WorkItem[]
  sessionsWithItems: SessionRef[]
  onClose: () => void
  onNavigateToItem: (id: string) => void
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onAddItem: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  onToggleTheme: () => void
  onMessageSession: (sessionId: string) => void
  onGoToSessions?: () => void
  onToggleViewMode?: () => void
  onDiscoverWork?: () => void
  onHealthCheck?: () => void
  onActivateStream?: (id: string) => void
  onRunScheduler?: () => void
  onTrainProfile?: () => void
}

const ICONS: Record<string, React.JSX.Element> = {
  search: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  add: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  ),
  status: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  theme: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  ),
  message: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  monitor: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  view: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  health: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  discover: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  scheduler: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  training: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  ),
}

export function CommandPalette({ items, sessionsWithItems, onClose, onNavigateToItem, onStatusChange, onAddItem, onOpenSettings, onRefresh, onToggleTheme, onMessageSession, onGoToSessions, onToggleViewMode, onDiscoverWork, onHealthCheck, onActivateStream, onRunScheduler, onTrainProfile }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trapRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const globalCommands: Command[] = useMemo(() => {
    const cmds: Command[] = [
      { id: 'cmd-add', label: 'Add work item', icon: 'add', action: () => { onClose(); onAddItem() } },
      { id: 'cmd-settings', label: 'Open settings', icon: 'settings', action: () => { onClose(); onOpenSettings() } },
      { id: 'cmd-refresh', label: 'Refresh queue', icon: 'refresh', action: () => { onClose(); onRefresh() } },
      { id: 'cmd-theme', label: 'Toggle theme', icon: 'theme', action: () => { onClose(); onToggleTheme() } },
    ]
    if (onGoToSessions) {
      cmds.push({ id: 'cmd-sessions', label: 'Go to sessions', description: 'View and manage active worker sessions', icon: 'monitor', action: () => { onClose(); onGoToSessions() } })
    }
    if (onToggleViewMode) {
      cmds.push({ id: 'cmd-view', label: 'Toggle view mode', description: 'Switch between card and compact table view', icon: 'view', action: () => { onClose(); onToggleViewMode() } })
    }
    if (onDiscoverWork) {
      cmds.push({ id: 'cmd-discover', label: 'Discover work', description: 'Scan configured sources for new work items', icon: 'discover', action: () => { onClose(); onDiscoverWork() } })
    }
    if (onHealthCheck) {
      cmds.push({ id: 'cmd-health', label: 'Health check', description: 'Check for zombies, stalled streams, and issues', icon: 'health', action: () => { onClose(); onHealthCheck() } })
    }
    if (onRunScheduler) {
      cmds.push({ id: 'cmd-scheduler', label: 'Run scheduler', description: 'Auto-activate ready items based on concurrency slots', icon: 'scheduler', action: () => { onClose(); onRunScheduler() } })
    }
    if (onTrainProfile) {
      cmds.push({ id: 'cmd-train', label: 'Train profile', description: 'Update delegator profile from latest session', icon: 'training', action: () => { onClose(); onTrainProfile() } })
    }
    return cmds
  }, [onClose, onAddItem, onOpenSettings, onRefresh, onToggleTheme, onGoToSessions, onToggleViewMode, onDiscoverWork, onHealthCheck, onRunScheduler, onTrainProfile])

  const itemCommands: Command[] = useMemo(() => {
    return items.map(item => ({
      id: `item-${item.id}`,
      label: item.title,
      description: `${item.status} — ${item.branch || 'no branch'}`,
      icon: 'status' as const,
      action: () => { onClose(); onNavigateToItem(item.id) },
    }))
  }, [items, onClose, onNavigateToItem])

  const statusCommands: Command[] = useMemo(() => {
    const cmds: Command[] = []
    for (const item of items) {
      if (item.status === 'queued') {
        if (onActivateStream) {
          cmds.push({ id: `activate-${item.id}`, label: `Activate stream: ${item.title}`, description: 'Create worktree + spawn session', icon: 'status', action: () => { onClose(); onActivateStream(item.id) } })
        } else {
          cmds.push({ id: `activate-${item.id}`, label: `Activate: ${item.title}`, icon: 'status', action: () => { onClose(); onStatusChange(item.id, 'active') } })
        }
      }
      if (item.status === 'active') {
        cmds.push({ id: `pause-${item.id}`, label: `Pause: ${item.title}`, icon: 'status', action: () => { onClose(); onStatusChange(item.id, 'paused') } })
        cmds.push({ id: `complete-${item.id}`, label: `Complete: ${item.title}`, icon: 'status', action: () => { onClose(); onStatusChange(item.id, 'completed') } })
      }
      if (item.status === 'paused') {
        cmds.push({ id: `resume-${item.id}`, label: `Resume: ${item.title}`, icon: 'status', action: () => { onClose(); onStatusChange(item.id, 'active') } })
      }
    }
    return cmds
  }, [items, onClose, onStatusChange, onActivateStream])

  const messageCommands: Command[] = useMemo(() => {
    return sessionsWithItems.map(ref => ({
      id: `msg-${ref.sessionId}`,
      label: `Message: ${ref.itemTitle}`,
      description: `Send message to session ${ref.sessionId.slice(0, 8)}`,
      icon: 'message' as const,
      action: () => { onClose(); onMessageSession(ref.sessionId) },
    }))
  }, [sessionsWithItems, onClose, onMessageSession])

  const allCommands = useMemo(() => [...globalCommands, ...messageCommands, ...itemCommands, ...statusCommands], [globalCommands, messageCommands, itemCommands, statusCommands])

  const filtered = useMemo(() => {
    if (!query.trim()) return globalCommands
    const q = query.toLowerCase()
    return allCommands.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      (cmd.description?.toLowerCase().includes(q))
    )
  }, [query, allCommands, globalCommands])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' && filtered[selectedIndex]) { filtered[selectedIndex].action(); return }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, filtered, selectedIndex])

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div className={styles.Palette} ref={trapRef} onClick={e => e.stopPropagation()}>
        <div className={styles.InputRow}>
          <svg className={styles.SearchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className={styles.Input}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search commands and work items..."
          />
          <kbd className={styles.Kbd}>Esc</kbd>
        </div>
        <div className={styles.List} ref={listRef}>
          {filtered.length === 0 && (
            <div className={styles.Empty}>No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={classnames(styles.Item, i === selectedIndex && styles.ItemSelected)}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className={styles.ItemIcon}>{ICONS[cmd.icon]}</span>
              <span className={styles.ItemInfo}>
                <span className={styles.ItemLabel}>{cmd.label}</span>
                {cmd.description && <span className={styles.ItemDescription}>{cmd.description}</span>}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.Footer}>
          <span className={styles.FooterHint}><kbd className={styles.FooterKbd}>↑↓</kbd> navigate</span>
          <span className={styles.FooterHint}><kbd className={styles.FooterKbd}>↵</kbd> select</span>
          <span className={styles.FooterHint}><kbd className={styles.FooterKbd}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
