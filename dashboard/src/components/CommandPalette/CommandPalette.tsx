import { useState, useEffect, useRef, useMemo } from 'react'
import classnames from 'classnames'
import styles from './CommandPalette.module.scss'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface Command {
  id: string
  label: string
  description?: string
  icon: 'search' | 'add' | 'settings' | 'refresh' | 'status' | 'theme' | 'message' | 'monitor'
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
}

export function CommandPalette({ items, sessionsWithItems, onClose, onNavigateToItem, onStatusChange, onAddItem, onOpenSettings, onRefresh, onToggleTheme, onMessageSession, onGoToSessions }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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
    return cmds
  }, [onClose, onAddItem, onOpenSettings, onRefresh, onToggleTheme, onGoToSessions])

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
        cmds.push({ id: `activate-${item.id}`, label: `Activate: ${item.title}`, icon: 'status', action: () => { onClose(); onStatusChange(item.id, 'active') } })
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
  }, [items, onClose, onStatusChange])

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
      <div className={styles.Palette} onClick={e => e.stopPropagation()}>
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
