import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import styles from './App.module.scss'
import { Header } from './components/Header/Header.tsx'
import { TabBar } from './components/TabBar/TabBar.tsx'
import { SearchBar } from './components/SearchBar/SearchBar.tsx'
import { StatsBar } from './components/StatsBar/StatsBar.tsx'
import { SortControls } from './components/SortControls/SortControls.tsx'
import type { SortField, SortDirection, StatusFilter } from './components/SortControls/SortControls.tsx'
import { WorkStreamList } from './components/WorkStreamList/WorkStreamList.tsx'
import { AddWorkItem } from './components/AddWorkItem/AddWorkItem.tsx'
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog.tsx'
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel.tsx'
import { SessionsPanel } from './components/SessionsPanel/SessionsPanel.tsx'
import { CommandPalette } from './components/CommandPalette/CommandPalette.tsx'
import { ToastContainer } from './components/Toast/Toast.tsx'
import { BatchActionBar } from './components/BatchActionBar/BatchActionBar.tsx'
import { SessionsView } from './components/SessionsView/SessionsView.tsx'
import { ActivityFeed } from './components/ActivityFeed/ActivityFeed.tsx'
import { ScrollToTop } from './components/ScrollToTop/ScrollToTop.tsx'
import { LoadingBar } from './components/LoadingBar/LoadingBar.tsx'
import { CompactList } from './components/CompactList/CompactList.tsx'
import { GroupedList } from './components/GroupedList/GroupedList.tsx'
import { DetailPanel } from './components/DetailPanel/DetailPanel.tsx'
import { FilterChips } from './components/FilterChips/FilterChips.tsx'
import { Breadcrumb } from './components/Breadcrumb/Breadcrumb.tsx'
import { KeyboardHints } from './components/KeyboardHints/KeyboardHints.tsx'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.tsx'
import { HealthPanel } from './components/HealthPanel/HealthPanel.tsx'
import { ShortcutSheet } from './components/ShortcutSheet/ShortcutSheet.tsx'
import { StatusFooter } from './components/StatusFooter/StatusFooter.tsx'
import { WelcomeGuide } from './components/WelcomeGuide/WelcomeGuide.tsx'
import { KanbanBoard } from './components/KanbanBoard/KanbanBoard.tsx'
import { OfflineIndicator } from './components/OfflineIndicator/OfflineIndicator.tsx'
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton.tsx'
import type { NewWorkItem } from './components/AddWorkItem/AddWorkItem.tsx'
import { useQueue } from './hooks/useQueue.ts'
import { useTheme } from './hooks/useTheme.ts'
import { useToast } from './hooks/useToast.ts'
import { useKeyboard } from './hooks/useKeyboard.ts'
import { useSettings } from './hooks/useSettings.ts'
import { useNotifications } from './hooks/useNotifications.ts'
import { useSessions } from './hooks/useSessions.ts'
import { useDocumentTitle } from './hooks/useDocumentTitle.ts'
import { useFaviconBadge } from './hooks/useFaviconBadge.ts'
import { usePersistedState } from './hooks/usePersistedState.ts'
import { useDebounce } from './hooks/useDebounce.ts'
import { useActivitySparkline } from './hooks/useActivitySparkline.ts'
import { useChangeDetection } from './hooks/useChangeDetection.ts'
import { useHashParam } from './hooks/useHashRoute.ts'
import { useFileDrop } from './hooks/useFileDrop.ts'
import { usePinnedItems } from './hooks/usePinnedItems.ts'
import { useSearchHistory } from './hooks/useSearchHistory.ts'
import { useZoom } from './hooks/useZoom.ts'
import { useScrollRestore } from './hooks/useScrollRestore.ts'
import { playNotificationSound } from './utils/sound.ts'
import { exportWorkItemsCsv, downloadCsv } from './utils/csv.ts'
import type { Plan } from './components/PlanEditor/PlanEditor.tsx'
import type { WorkItemStatus, MessageEntry } from './types.ts'

export function App() {
  const { settings, update: updateSetting, reset: resetSettings, open: settingsOpen, setOpen: setSettingsOpen } = useSettings()
  const queue = useQueue(settings.pollIntervalMs)
  const { theme, toggle: toggleTheme } = useTheme()
  const { zoomIn, zoomOut, resetZoom } = useZoom()
  const { toasts, history, addToast: rawAddToast, dismissToast, clearHistory } = useToast()
  const addToast = useCallback((...args: Parameters<typeof rawAddToast>) => {
    rawAddToast(...args)
    if (settings.soundEnabled) {
      playNotificationSound(args[1] || 'info')
    }
  }, [rawAddToast, settings.soundEnabled])
  const activitySparkline = useActivitySparkline(history)
  const { pinned, togglePin } = usePinnedItems()
  const changes = useChangeDetection(queue.items)

  // Auto-toast when items change status from polling
  useEffect(() => {
    for (const [, diffs] of changes) {
      for (const diff of diffs) {
        if (diff.field === 'status') {
          const item = queue.items.find(i => i.id === diff.id)
          if (item) {
            rawAddToast(`"${item.title}" changed to ${diff.to}`, 'info')
          }
        }
      }
    }
  }, [changes, queue.items, rawAddToast])
  const { isDraggingOver } = useFileDrop({ accept: ['.json'], onDrop: handleImportQueue })
  const { history: searchHistory, addSearch, clearHistory: clearSearchHistory, removeItem: removeSearchItem } = useSearchHistory()
  useNotifications(queue.items, settings.notificationsEnabled)
  const { sessions, sendMessage, refresh: refreshSessions } = useSessions()
  const zombieCount = sessions.filter(s => s.state === 'zombie').length
  useDocumentTitle({
    activeCount: queue.activeItems.length,
    blockedCount: queue.blockedItems.length,
    zombieCount,
  })
  useFaviconBadge(queue.blockedItems.length > 0 || zombieCount > 0)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, MessageEntry[]>>({})
  const [activeTab, setActiveTab] = useHashParam('tab', 'projects')
  const [showAddForm, setShowAddForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 200)
  // Record searches to history when user clears after searching
  const prevDebouncedRef = useRef(debouncedSearch)
  useEffect(() => {
    if (prevDebouncedRef.current && !debouncedSearch) {
      addSearch(prevDebouncedRef.current)
    }
    prevDebouncedRef.current = debouncedSearch
  }, [debouncedSearch, addSearch])
  const [showCompleted, setShowCompleted] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showActivityFeed, setShowActivityFeed] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const [viewMode, setViewMode] = usePersistedState<'cards' | 'compact' | 'grouped' | 'kanban'>('viewMode', 'cards')
  const [sortField, setSortField] = usePersistedState<SortField>('sortField', 'priority')
  const [sortDirection, setSortDirection] = usePersistedState<SortDirection>('sortDirection', 'asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  useScrollRestore(activeTab, mainRef.current)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)
  const [activatingIds, setActivatingIds] = useState<Set<string>>(new Set())
  const [tearingDownIds, setTearingDownIds] = useState<Set<string>>(new Set())
  const [healthIssues, setHealthIssues] = useState(0)
  const [showHealthPanel, setShowHealthPanel] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = usePersistedState('welcomeDismissed', false)

  // Periodic health check for issue count
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/api/health')
        if (res.ok) {
          const data = await res.json()
          setHealthIssues(data.issues?.length ?? 0)
        }
      } catch { /* ignore */ }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 60000)
    return () => clearInterval(interval)
  }, [])

  const projectBlockers = queue.projects.filter(i => i.blockers.some(b => !b.resolved)).length
  const qfBlockers = queue.quickFixes.filter(i => i.blockers.some(b => !b.resolved)).length
  const tabs = [
    { id: 'projects', label: 'Projects', count: queue.projects.length, alertCount: projectBlockers },
    { id: 'quick_fixes', label: 'Quick Fixes', count: queue.quickFixes.length, alertCount: qfBlockers },
    { id: 'all', label: 'All', count: queue.items.length, alertCount: queue.blockedItems.length },
    { id: 'sessions', label: 'Sessions', count: sessions.length, alertCount: zombieCount },
  ]

  const filteredItems = useMemo(() => {
    let pool = activeTab === 'projects'
      ? queue.projects
      : activeTab === 'quick_fixes'
        ? queue.quickFixes
        : queue.items

    if (!showCompleted && statusFilter !== 'completed') {
      pool = pool.filter(i => i.status !== 'completed')
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'blocked') {
        pool = pool.filter(i => i.blockers.some(b => !b.resolved))
      } else {
        pool = pool.filter(i => i.status === statusFilter)
      }
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      pool = pool.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.branch.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      )
    }

    return pool
  }, [activeTab, queue.projects, queue.quickFixes, queue.items, debouncedSearch, showCompleted, statusFilter])

  useKeyboard({
    onNewItem: useCallback(() => setShowAddForm(true), []),
    onFocusSearch: useCallback(() => searchRef.current?.focus(), []),
    onEscape: useCallback(() => {
      if (showShortcuts) { setShowShortcuts(false); return }
      if (showCommandPalette) { setShowCommandPalette(false); return }
      if (showHealthPanel) { setShowHealthPanel(false); return }
      if (detailItemId) { setDetailItemId(null); return }
      if (showActivityFeed) { setShowActivityFeed(false); return }
      if (showSessions) { setShowSessions(false); return }
      if (settingsOpen) { setSettingsOpen(false); return }
      if (confirmAction) { setConfirmAction(null); return }
      if (selectionMode) { setSelectedIds(new Set()); setSelectionMode(false); return }
      if (showAddForm) { setShowAddForm(false); return }
      if (searchQuery) { setSearchQuery(''); return }
    }, [showShortcuts, showCommandPalette, showHealthPanel, detailItemId, showActivityFeed, showSessions, settingsOpen, confirmAction, selectionMode, showAddForm, searchQuery, setSettingsOpen]),
    onRefresh: useCallback(() => {
      queue.refresh()
      addToast('Queue refreshed', 'info')
    }, [queue, addToast]),
    onCommandPalette: useCallback(() => setShowCommandPalette(prev => !prev), []),
    onTabSwitch: useCallback((index: number) => {
      const tabIds = ['projects', 'quick_fixes', 'all', 'sessions']
      if (index >= 0 && index < tabIds.length) {
        setActiveTab(tabIds[index])
      }
    }, []),
    onSelectAll: useCallback(() => {
      if (!selectionMode) {
        setSelectionMode(true)
      }
      setSelectedIds(prev => {
        if (prev.size === filteredItems.length && filteredItems.length > 0) {
          return new Set()
        }
        return new Set(filteredItems.map(i => i.id))
      })
    }, [selectionMode, filteredItems]),
    onToggleViewMode: useCallback(() => {
      setViewMode(prev => prev === 'cards' ? 'compact' : prev === 'compact' ? 'grouped' : prev === 'grouped' ? 'kanban' : 'cards')
    }, [setViewMode]),
    onNavigateDown: useCallback(() => {
      if (filteredItems.length === 0) return
      setFocusedItemId(prev => {
        if (!prev) return filteredItems[0].id
        const idx = filteredItems.findIndex(i => i.id === prev)
        return filteredItems[Math.min(idx + 1, filteredItems.length - 1)].id
      })
    }, [filteredItems]),
    onNavigateUp: useCallback(() => {
      if (filteredItems.length === 0) return
      setFocusedItemId(prev => {
        if (!prev) return filteredItems[filteredItems.length - 1].id
        const idx = filteredItems.findIndex(i => i.id === prev)
        return filteredItems[Math.max(idx - 1, 0)].id
      })
    }, [filteredItems]),
    onOpenFocused: useCallback(() => {
      if (focusedItemId) setDetailItemId(focusedItemId)
    }, [focusedItemId]),
    onShowShortcuts: useCallback(() => setShowShortcuts(prev => !prev), []),
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onZoomReset: resetZoom,
  })

  async function handleDuplicate(id: string) {
    const item = queue.items.find(i => i.id === id)
    if (!item) return
    try {
      await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${item.title} (copy)`,
          description: item.description,
          type: item.type,
          priority: item.priority + 1,
          branch: '',
        }),
      })
      queue.refresh()
      addToast('Work item duplicated', 'success')
    } catch {
      addToast('Failed to duplicate work item', 'error')
    }
  }

  async function handleAddItem(item: NewWorkItem) {
    try {
      await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      setShowAddForm(false)
      queue.refresh()
      addToast('Work item added', 'success')
    } catch {
      addToast('Failed to add work item', 'error')
    }
  }

  function handleStatusChange(id: string, status: WorkItemStatus) {
    const item = queue.items.find(i => i.id === id)
    const previousStatus = item?.status
    const labels: Record<string, string> = {
      active: 'activated',
      paused: 'paused',
      completed: 'completed',
      queued: 'queued',
      review: 'moved to review',
    }
    queue.updateItem(id, { status })
    addToast(
      `Work item ${labels[status] || status}`,
      'success',
      previousStatus ? {
        label: 'Undo',
        onClick: () => {
          queue.updateItem(id, { status: previousStatus })
          addToast('Status change reverted', 'info')
        },
      } : undefined,
    )
  }

  function handlePriorityChange(id: string, priority: number) {
    queue.updateItem(id, { priority })
  }

  function handleEdit(id: string, updates: { title?: string; description?: string }) {
    queue.updateItem(id, updates)
    addToast('Work item updated', 'success')
  }

  function handleAddBlocker(id: string, description: string) {
    queue.addBlocker(id, description)
    addToast('Blocker added', 'info')
  }

  function handleResolveBlocker(id: string, blockerId: string) {
    queue.resolveBlocker(id, blockerId, true)
    addToast('Blocker resolved', 'success')
  }

  function handleUnresolveBlocker(id: string, blockerId: string) {
    queue.resolveBlocker(id, blockerId, false)
    addToast('Blocker reopened', 'info')
  }

  function handleDelegatorToggle(id: string, enabled: boolean) {
    queue.updateItem(id, { delegator_enabled: enabled })
    addToast(`Delegator ${enabled ? 'enabled' : 'disabled'}`, 'info')
  }

  function handleReorder(dragId: string, dropId: string) {
    const dragItem = queue.items.find(i => i.id === dragId)
    if (!dragItem) return
    queue.reorderItems(dragId, dropId)
    addToast(`Reordered "${dragItem.title}"`, 'info')
  }

  const sessionsWithItems = useMemo(() => {
    const refs: { itemId: string; itemTitle: string; sessionId: string }[] = []
    for (const item of queue.items) {
      const session = item.session_id
        ? sessions.find(s => s.id === item.session_id)
        : item.worktree_path
          ? sessions.find(s => s.cwd === item.worktree_path || item.worktree_path!.startsWith(s.cwd))
          : undefined
      if (session) {
        refs.push({ itemId: item.id, itemTitle: item.title, sessionId: session.id })
      }
    }
    return refs
  }, [queue.items, sessions])

  async function handleSendMessage(sessionId: string, text: string) {
    const entry: MessageEntry = {
      id: `msg-${Date.now()}`,
      text,
      timestamp: new Date().toISOString(),
      direction: 'sent',
    }
    setMessagesBySession(prev => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), entry],
    }))
    const ok = await sendMessage(sessionId, text)
    if (ok) {
      addToast('Message sent', 'success')
    } else {
      addToast('Failed to send message', 'error')
    }
  }

  function handleToggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleClearSelection() {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  function handleBatchStatusChange(status: WorkItemStatus) {
    const count = selectedIds.size
    for (const id of selectedIds) {
      queue.updateItem(id, { status })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    const labels: Record<string, string> = {
      active: 'activated', paused: 'paused', completed: 'completed',
      queued: 'queued', review: 'moved to review',
    }
    addToast(`${count} item${count !== 1 ? 's' : ''} ${labels[status] || status}`, 'success')
  }

  function handleBatchDelete() {
    setConfirmAction({
      title: 'Remove Selected Items',
      message: `Are you sure you want to remove ${selectedIds.size} item${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Remove All',
      danger: true,
      onConfirm: () => {
        const count = selectedIds.size
        for (const id of selectedIds) {
          queue.deleteItem(id)
        }
        setSelectedIds(new Set())
        setSelectionMode(false)
        setConfirmAction(null)
        addToast(`${count} item${count !== 1 ? 's' : ''} removed`, 'success')
      },
    })
  }

  async function handleKillSession(sessionId: string) {
    try {
      const res = await fetch('/api/sessions/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (res.ok) {
        addToast('Session killed', 'success')
      } else {
        addToast('Failed to kill session', 'error')
      }
    } catch {
      addToast('Failed to kill session', 'error')
    }
  }

  async function handleReconnectSession(sessionId: string) {
    try {
      const res = await fetch('/api/sessions/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (res.ok) {
        addToast('Session reconnecting...', 'info')
      } else {
        addToast('Failed to reconnect session', 'error')
      }
    } catch {
      addToast('Failed to reconnect session', 'error')
    }
  }

  function handleNavigateToItem(id: string) {
    const item = queue.items.find(i => i.id === id)
    if (!item) return
    // Switch to the right tab so the item is visible
    if (item.type === 'project') {
      setActiveTab('projects')
    } else if (item.type === 'quick_fix') {
      setActiveTab('quick_fixes')
    } else {
      setActiveTab('all')
    }
    // Clear search so the item isn't filtered out
    setSearchQuery('')
    setStatusFilter('all')
    setFocusedItemId(id)
  }

  async function handleImportQueue(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const items = Array.isArray(data) ? data : data.items
      if (!Array.isArray(items) || items.length === 0) {
        addToast('Invalid file: no items found', 'error')
        return
      }
      let imported = 0
      for (const item of items) {
        if (!item.title) continue
        await fetch('/api/queue/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.title,
            description: item.description || '',
            type: item.type || 'quick_fix',
            priority: item.priority ?? 50,
            branch: item.branch || '',
          }),
        })
        imported++
      }
      queue.refresh()
      addToast(`Imported ${imported} work item${imported !== 1 ? 's' : ''}`, 'success')
    } catch {
      addToast('Failed to import: invalid JSON file', 'error')
    }
  }

  function handleExportQueue() {
    const data = { version: 1, items: queue.items, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orchestrator-queue-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    addToast('Queue exported', 'success')
  }

  function handleExportCsv() {
    const csv = exportWorkItemsCsv(queue.items)
    downloadCsv(csv, `orchestrator-queue-${new Date().toISOString().slice(0, 10)}.csv`)
    addToast('Queue exported as CSV', 'success')
  }

  function handleDelete(id: string) {
    const item = queue.items.find(i => i.id === id)
    setConfirmAction({
      title: 'Remove Work Item',
      message: `Are you sure you want to remove "${item?.title || id}"? This cannot be undone.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        queue.deleteItem(id)
        setConfirmAction(null)
        addToast('Work item removed', 'success')
      },
    })
  }

  function handlePrUrlChange(id: string, prUrl: string) {
    queue.updateItem(id, { pr_url: prUrl || null })
    addToast('PR URL updated', 'success')
  }

  async function handlePlanChange(id: string, plan: Plan) {
    try {
      await fetch('/api/queue/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, metadata: { plan } }),
      })
      queue.refresh()
      if (plan.approved) {
        addToast('Plan approved — ready for activation', 'success')
      } else {
        addToast('Plan updated', 'info')
      }
    } catch {
      addToast('Failed to save plan', 'error')
    }
  }

  async function handleActivateStream(id: string) {
    const item = queue.items.find(i => i.id === id)
    if (!item) return
    setActivatingIds(prev => new Set(prev).add(id))
    addToast(`Activating "${item.title}" — creating worktree and session...`, 'info')
    try {
      const res = await fetch('/api/stream/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id }),
      })
      if (res.ok) {
        addToast(`"${item.title}" activated — worktree and session ready`, 'success')
        queue.refresh()
        refreshSessions()
      } else {
        const data = await res.json()
        addToast(`Activation failed: ${data.error || 'Unknown error'}`, 'error')
      }
    } catch {
      addToast('Failed to activate stream', 'error')
    } finally {
      setActivatingIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  function handleTeardownStream(id: string) {
    const item = queue.items.find(i => i.id === id)
    if (!item) return
    setConfirmAction({
      title: 'Tear Down Work Stream',
      message: `This will kill the session, remove the worktree, and mark "${item.title}" as completed. The git branch will be preserved.`,
      confirmLabel: 'Tear Down',
      danger: true,
      onConfirm: async () => {
        setConfirmAction(null)
        setTearingDownIds(prev => new Set(prev).add(id))
        addToast(`Tearing down "${item.title}"...`, 'info')
        try {
          const res = await fetch('/api/stream/teardown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: id }),
          })
          if (res.ok) {
            addToast(`"${item.title}" torn down`, 'success')
            queue.refresh()
            refreshSessions()
          } else {
            const data = await res.json()
            addToast(`Teardown failed: ${data.error || 'Unknown error'}`, 'error')
          }
        } catch {
          addToast('Failed to tear down stream', 'error')
        } finally {
          setTearingDownIds(prev => { const next = new Set(prev); next.delete(id); return next })
        }
      },
    })
  }

  async function handleDiscoverWork() {
    addToast('Discovering work items...', 'info')
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        queue.refresh()
        addToast(data.output?.trim() ? `Discovery: ${data.output.trim().split('\n').pop()}` : 'Work discovery complete', 'success')
      } else {
        addToast('Work discovery failed', 'error')
      }
    } catch {
      addToast('Failed to discover work', 'error')
    }
  }

  async function handleAutoRecover() {
    const zombies = sessions.filter(s => s.state === 'zombie')
    if (zombies.length === 0) return
    addToast(`Recovering ${zombies.length} zombie session${zombies.length !== 1 ? 's' : ''}...`, 'info')
    for (const z of zombies) {
      try {
        await fetch('/api/sessions/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: z.cwd }),
        })
      } catch { /* continue */ }
    }
    setTimeout(() => { refreshSessions(); queue.refresh() }, 3000)
  }

  return (
    <div className={styles.Root}>
      <a className="skip-to-content" href="#main-content">Skip to content</a>
      <OfflineIndicator />
      <LoadingBar active={queue.loading} />
      <Header
        activeCount={queue.activeItems.length}
        queuedCount={queue.queuedItems.length}
        pausedCount={queue.pausedItems.length}
        blockedCount={queue.blockedItems.length}
        sessionCount={sessions.length}
        activityCount={history.length}
        activitySparkline={activitySparkline}
        healthIssues={healthIssues}
        lastUpdated={queue.lastUpdated}
        onAddClick={() => setShowAddForm(!showAddForm)}
        showingAddForm={showAddForm}
        theme={theme}
        onThemeToggle={toggleTheme}
        onSettingsClick={() => setSettingsOpen(true)}
        onSessionsClick={() => setShowSessions(true)}
        onActivityFeedClick={() => setShowActivityFeed(true)}
        onHealthClick={() => setShowHealthPanel(true)}
        onDiscoverClick={handleDiscoverWork}
      />
      <main ref={mainRef} id="main-content" className={styles.Main}>
        <ErrorBoundary fallbackLabel="The main content area crashed. Try refreshing the page.">
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        {activeTab === 'sessions' ? (
          <SessionsView
            sessions={sessions}
            items={queue.items}
            messagesBySession={messagesBySession}
            onSendMessage={handleSendMessage}
            onKillSession={handleKillSession}
            onReconnectSession={handleReconnectSession}
            onRefreshSessions={() => { refreshSessions(); addToast('Sessions refreshed', 'info') }}
          />
        ) : (
          <>
            <SearchBar
              ref={searchRef}
              value={searchQuery}
              onChange={setSearchQuery}
              resultCount={debouncedSearch.trim() ? filteredItems.length : undefined}
              searchHistory={searchHistory}
              onSearchSelect={q => { setSearchQuery(q) }}
              onClearHistory={clearSearchHistory}
              onRemoveHistoryItem={removeSearchItem}
            />
            <StatsBar
              totalItems={queue.items.length}
              activeCount={queue.activeItems.length}
              queuedCount={queue.queuedItems.length}
              pausedCount={queue.pausedItems.length}
              completedCount={queue.completedItems.length}
              blockedCount={queue.blockedItems.length}
              showCompleted={showCompleted}
              onToggleCompleted={() => setShowCompleted(!showCompleted)}
            />
            <FilterChips
              active={statusFilter}
              counts={{
                active: queue.activeItems.length,
                queued: queue.queuedItems.length,
                review: queue.reviewItems.length,
                paused: queue.pausedItems.length,
                blocked: queue.blockedItems.length,
                completed: queue.completedItems.length,
              }}
              onChange={setStatusFilter}
            />
            <Breadcrumb
              tab={activeTab}
              searchQuery={debouncedSearch.trim() || undefined}
              statusFilter={statusFilter}
              viewMode={viewMode}
              itemCount={filteredItems.length}
            />
            <div className={styles.ControlsRow}>
              <SortControls
                sortField={sortField}
                sortDirection={sortDirection}
                statusFilter={statusFilter}
                onSortChange={(field, direction) => { setSortField(field); setSortDirection(direction) }}
                onStatusFilterChange={setStatusFilter}
              />
              <button
                className={`${styles.SelectToggle} ${selectionMode ? styles.SelectToggleActive : ''}`}
                onClick={() => {
                  if (selectionMode) {
                    setSelectedIds(new Set())
                  }
                  setSelectionMode(!selectionMode)
                }}
                title={selectionMode ? 'Exit selection mode' : 'Select items'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
                {selectionMode ? 'Cancel' : 'Select'}
              </button>
              {selectionMode && filteredItems.length > 0 && (
                <label className={styles.SelectAllLabel}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                    onChange={() => {
                      if (selectedIds.size === filteredItems.length) {
                        setSelectedIds(new Set())
                      } else {
                        setSelectedIds(new Set(filteredItems.map(i => i.id)))
                      }
                    }}
                    className={styles.SelectAllCheckbox}
                  />
                  <span className={styles.SelectAllText}>
                    {selectedIds.size === filteredItems.length ? 'Deselect all' : `Select all (${filteredItems.length})`}
                  </span>
                </label>
              )}
              <button
                className={styles.ViewModeToggle}
                onClick={() => setViewMode(viewMode === 'cards' ? 'compact' : viewMode === 'compact' ? 'grouped' : viewMode === 'grouped' ? 'kanban' : 'cards')}
                title={viewMode === 'cards' ? 'Compact view' : viewMode === 'compact' ? 'Grouped view' : viewMode === 'grouped' ? 'Kanban view' : 'Card view'}
              >
                {viewMode === 'cards' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                ) : viewMode === 'compact' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="4" rx="1" />
                    <rect x="3" y="10" width="18" height="4" rx="1" />
                    <rect x="3" y="17" width="18" height="4" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                )}
              </button>
            </div>
            {showAddForm && (
              <AddWorkItem
                onAdd={handleAddItem}
                onCancel={() => setShowAddForm(false)}
              />
            )}
            {!welcomeDismissed && queue.items.length === 0 && !queue.loading && (
              <WelcomeGuide
                onDismiss={() => setWelcomeDismissed(true)}
                onAddItem={() => { setWelcomeDismissed(true); setShowAddForm(true) }}
                onOpenSettings={() => { setWelcomeDismissed(true); setSettingsOpen(true) }}
              />
            )}
            <div key={viewMode} className={styles.ViewTransition}>
            {viewMode === 'compact' ? (
              <CompactList
                items={filteredItems}
                selectable={selectionMode}
                selectedIds={selectedIds}
                onSelect={handleToggleSelect}
                onStatusChange={handleStatusChange}
                onActivateStream={handleActivateStream}
                activatingIds={activatingIds}
                focusedItemId={focusedItemId}
                onNavigate={id => setDetailItemId(id)}
                onReorder={handleReorder}
                onEdit={handleEdit}
              />
            ) : viewMode === 'grouped' ? (
              <GroupedList
                items={filteredItems}
                onStatusChange={handleStatusChange}
                onNavigate={id => setDetailItemId(id)}
              />
            ) : viewMode === 'kanban' ? (
              <KanbanBoard
                items={filteredItems}
                onStatusChange={handleStatusChange}
                onNavigate={id => setDetailItemId(id)}
              />
            ) : (
            <WorkStreamList
              items={filteredItems}
              loading={queue.loading}
              hasSearch={searchQuery.trim().length > 0}
              sortField={sortField}
              sortDirection={sortDirection}
              sessions={sessions}
              messagesBySession={messagesBySession}
              selectable={selectionMode}
              selectedIds={selectedIds}
              onSelect={handleToggleSelect}
              focusedItemId={focusedItemId}
              onClearFocus={() => setFocusedItemId(null)}
              pinnedIds={pinned}
              onTogglePin={togglePin}
              emptyLabel={
                activeTab === 'quick_fixes' ? 'No quick fixes' :
                activeTab === 'projects' ? 'No projects' : undefined
              }
              emptyTab={activeTab}
              onAddClick={() => setShowAddForm(true)}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onDelegatorToggle={handleDelegatorToggle}
              onEdit={handleEdit}
              onAddBlocker={handleAddBlocker}
              onResolveBlocker={handleResolveBlocker}
              onUnresolveBlocker={handleUnresolveBlocker}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onActivateStream={handleActivateStream}
              onTeardownStream={handleTeardownStream}
              activatingIds={activatingIds}
              tearingDownIds={tearingDownIds}
              onPrUrlChange={handlePrUrlChange}
              onPlanChange={handlePlanChange}
              onReorder={handleReorder}
              onSendMessage={handleSendMessage}
            />
            )}
            </div>
          </>
        )}
        </ErrorBoundary>
      </main>
      <StatusFooter
        totalItems={queue.items.length}
        filteredCount={filteredItems.length}
        sessionCount={sessions.length}
        pollIntervalMs={settings.pollIntervalMs}
        lastUpdated={queue.lastUpdated}
        viewMode={viewMode}
      />
      {selectionMode && selectedIds.size > 0 && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          onStatusChange={handleBatchStatusChange}
          onDelete={handleBatchDelete}
          onClearSelection={handleClearSelection}
        />
      )}
      <KeyboardHints />
      <FloatingActionButton
        actions={[
          {
            icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
            label: 'Add Item',
            onClick: () => setShowAddForm(true),
          },
          {
            icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
            label: 'Search',
            onClick: () => searchRef.current?.focus(),
          },
          {
            icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>,
            label: 'Refresh',
            onClick: () => { queue.refresh(); addToast('Queue refreshed', 'info') },
          },
        ]}
      />
      <ScrollToTop scrollContainer={mainRef.current} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSetting}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          onExportQueue={handleExportQueue}
          onExportCsv={handleExportCsv}
          onImportQueue={handleImportQueue}
        />
      )}
      {showActivityFeed && (
        <ActivityFeed
          history={history}
          onClear={clearHistory}
          onClose={() => setShowActivityFeed(false)}
        />
      )}
      {showSessions && (
        <SessionsPanel
          sessions={sessions}
          messagesBySession={messagesBySession}
          onClose={() => setShowSessions(false)}
          onSendMessage={handleSendMessage}
        />
      )}
      {detailItemId && (() => {
        const detailItem = queue.items.find(i => i.id === detailItemId)
        if (!detailItem) return null
        return (
          <DetailPanel
            item={detailItem}
            onClose={() => setDetailItemId(null)}
            onStatusChange={(id, status) => { handleStatusChange(id, status); setDetailItemId(null) }}
            onDelete={(id) => { handleDelete(id); setDetailItemId(null) }}
            onDuplicate={(id) => { handleDuplicate(id); setDetailItemId(null) }}
          />
        )
      })()}
      {showCommandPalette && (
        <CommandPalette
          items={queue.items}
          sessionsWithItems={sessionsWithItems}
          onClose={() => setShowCommandPalette(false)}
          onNavigateToItem={handleNavigateToItem}
          onStatusChange={handleStatusChange}
          onAddItem={() => setShowAddForm(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onRefresh={() => { queue.refresh(); addToast('Queue refreshed', 'info') }}
          onToggleTheme={toggleTheme}
          onMessageSession={(sessionId) => {
            setShowCommandPalette(false)
            const text = prompt(`Message to session ${sessionId.slice(0, 8)}:`)
            if (text) handleSendMessage(sessionId, text)
          }}
          onGoToSessions={() => setActiveTab('sessions')}
          onToggleViewMode={() => setViewMode(prev => prev === 'cards' ? 'compact' : prev === 'compact' ? 'grouped' : prev === 'grouped' ? 'kanban' : 'cards')}
          onDiscoverWork={handleDiscoverWork}
          onHealthCheck={() => setShowHealthPanel(true)}
          onActivateStream={handleActivateStream}
        />
      )}
      {showHealthPanel && (
        <HealthPanel
          onClose={() => setShowHealthPanel(false)}
          onAutoRecover={handleAutoRecover}
        />
      )}
      {showShortcuts && (
        <ShortcutSheet onClose={() => setShowShortcuts(false)} />
      )}
      {isDraggingOver && (
        <div className={styles.DropOverlay}>
          <div className={styles.DropZone}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className={styles.DropLabel}>Drop .json file to import work items</span>
          </div>
        </div>
      )}
    </div>
  )
}
