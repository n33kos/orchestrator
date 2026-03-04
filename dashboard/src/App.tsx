import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import styles from './App.module.scss'
import { Header } from './components/Header/Header.tsx'
import { TabBar } from './components/TabBar/TabBar.tsx'
import { SearchBar } from './components/SearchBar/SearchBar.tsx'
import { StatsBar } from './components/StatsBar/StatsBar.tsx'
import { SortControls } from './components/SortControls/SortControls.tsx'
import type { SortField, SortDirection } from './components/SortControls/SortControls.tsx'
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
import { GlobalSearch } from './components/GlobalSearch/GlobalSearch.tsx'
import { AnalyticsView } from './components/AnalyticsView/AnalyticsView.tsx'
import { DelegatorPanel } from './components/DelegatorPanel/DelegatorPanel.tsx'
import { DiscoverPanel } from './components/DiscoverPanel/DiscoverPanel.tsx'
import { SchedulerLog } from './components/SchedulerLog/SchedulerLog.tsx'
import { useDelegators } from './hooks/useDelegators.ts'
import { useEvents } from './hooks/useEvents.ts'
import { BreakpointIndicator } from './components/BreakpointIndicator/BreakpointIndicator.tsx'
import { PinnedSection } from './components/PinnedSection/PinnedSection.tsx'
import type { NewWorkItem } from './components/AddWorkItem/AddWorkItem.tsx'
import { useQueue } from './hooks/useQueue.ts'
import { useTheme } from './hooks/useTheme.ts'
import { useToast } from './hooks/useToast.ts'
import { useKeyboard } from './hooks/useKeyboard.ts'
import { useSettings } from './hooks/useSettings.ts'
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
import { usePageVisibility } from './hooks/usePageVisibility.ts'
import { useBeforeUnload } from './hooks/useBeforeUnload.ts'
import { useOrchestratorPolling } from './hooks/useOrchestratorPolling.ts'
import { useStreamActions } from './hooks/useStreamActions.ts'
import { playNotificationSound } from './utils/sound.ts'
import { exportWorkItemsCsv, downloadCsv } from './utils/csv.ts'
import type { WorkItemStatus } from './types.ts'

export function App() {
  const { settings, update: updateSetting, reset: resetSettings, open: settingsOpen, setOpen: setSettingsOpen } = useSettings()
  const pageVisible = usePageVisibility()
  const effectivePollInterval = pageVisible ? settings.pollIntervalMs : settings.pollIntervalMs * 6
  const queue = useQueue(effectivePollInterval)
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
  const { sessions, sendMessage, refresh: refreshSessions } = useSessions()
  const zombieCount = sessions.filter(s => s.state === 'zombie').length
  const delegatorData = useDelegators(pageVisible ? 10_000 : 60_000)
  const { events: orchestratorEvents } = useEvents(pageVisible ? 15_000 : 60_000)
  useDocumentTitle({
    activeCount: queue.activeItems.length,
    blockedCount: queue.blockedItems.length,
    zombieCount,
  })
  useFaviconBadge(queue.blockedItems.length > 0 || zombieCount > 0)
  useBeforeUnload(queue.activeItems.length > 0 || sessions.filter(s => s.state === 'thinking' || s.state === 'responding').length > 0)

  // Orchestrator polling (health checks, pause state, auto-scheduler, PR status)
  const { orchestratorPaused, healthIssues, handlePauseToggle } = useOrchestratorPolling({
    autoActivate: settings.autoActivate,
    items: queue.items,
    refresh: queue.refresh,
    refreshSessions,
    updateItem: queue.updateItem,
    addToast,
  })

  // Stream actions (status changes, activate, teardown, messaging, etc.)
  const actions = useStreamActions({
    items: queue.items,
    sessions,
    updateItem: queue.updateItem,
    deleteItem: queue.deleteItem,
    reorderItems: queue.reorderItems,
    refresh: queue.refresh,
    refreshSessions,
    sendMessage,
    addToast,
  })

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
  const [statusFilter, setStatusFilter] = useState<Set<WorkItemStatus>>(
    new Set<WorkItemStatus>(['active', 'planning', 'queued', 'review', 'completed'])
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  useScrollRestore(activeTab, mainRef.current)
  const [showHealthPanel, setShowHealthPanel] = useState(false)
  const [showDiscoverPanel, setShowDiscoverPanel] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = usePersistedState('welcomeDismissed', false)

  const tabs = [
    { id: 'projects', label: 'Projects', count: queue.items.length, alertCount: queue.blockedItems.length },
    { id: 'delegators', label: 'Delegators', count: delegatorData.count || undefined, alertCount: delegatorData.alertCount || undefined },
    { id: 'sessions', label: 'Sessions', count: sessions.length, alertCount: zombieCount },
    { id: 'analytics', label: 'Analytics' },
    { id: 'scheduler-log', label: 'Scheduler Log' },
  ]

  const filteredItems = useMemo(() => {
    let pool = queue.items

    // Apply multi-select status filter
    if (statusFilter.size > 0) {
      pool = pool.filter(i => statusFilter.has(i.status))
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
  }, [queue.items, debouncedSearch, statusFilter])

  useKeyboard({
    onNewItem: useCallback(() => setShowAddForm(true), []),
    onFocusSearch: useCallback(() => searchRef.current?.focus(), []),
    onEscape: useCallback(() => {
      if (showGlobalSearch) { setShowGlobalSearch(false); return }
      if (showShortcuts) { setShowShortcuts(false); return }
      if (showCommandPalette) { setShowCommandPalette(false); return }
      if (showHealthPanel) { setShowHealthPanel(false); return }
      if (showDiscoverPanel) { setShowDiscoverPanel(false); return }
      if (detailItemId) { setDetailItemId(null); return }
      if (showActivityFeed) { setShowActivityFeed(false); return }
      if (showSessions) { setShowSessions(false); return }
      if (settingsOpen) { setSettingsOpen(false); return }
      if (actions.confirmAction) { actions.setConfirmAction(null); return }
      if (selectionMode) { setSelectedIds(new Set()); setSelectionMode(false); return }
      if (showAddForm) { setShowAddForm(false); return }
      if (searchQuery) { setSearchQuery(''); return }
    }, [showGlobalSearch, showShortcuts, showCommandPalette, showHealthPanel, showDiscoverPanel, detailItemId, showActivityFeed, showSessions, settingsOpen, actions.confirmAction, selectionMode, showAddForm, searchQuery, setSettingsOpen]),
    onRefresh: useCallback(() => {
      queue.refresh()
      addToast('Queue refreshed', 'info')
    }, [queue, addToast]),
    onCommandPalette: useCallback(() => setShowCommandPalette(prev => !prev), []),
    onTabSwitch: useCallback((index: number) => {
      const tabIds = ['projects', 'delegators', 'sessions', 'analytics', 'scheduler-log']
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
    onGlobalSearch: useCallback(() => setShowGlobalSearch(prev => !prev), []),
    onDiscoverPanel: useCallback(() => setShowDiscoverPanel(prev => !prev), []),
    onHealthPanel: useCallback(() => setShowHealthPanel(prev => !prev), []),
    onSettingsPanel: useCallback(() => setSettingsOpen(prev => !prev), [setSettingsOpen]),
  })

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
    actions.setConfirmAction({
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
        actions.setConfirmAction(null)
        addToast(`${count} item${count !== 1 ? 's' : ''} removed`, 'success')
      },
    })
  }

  function handleNavigateToItem(id: string) {
    const item = queue.items.find(i => i.id === id)
    if (!item) return
    // Switch to projects tab (which shows all items)
    setActiveTab('projects')
    // Clear search and show all statuses so the item isn't filtered out
    setSearchQuery('')
    setStatusFilter(new Set<WorkItemStatus>(['active', 'planning', 'queued', 'review', 'completed']))
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

  function handleDiscoverWork() {
    setShowDiscoverPanel(true)
  }

  async function handleRunScheduler() {
    addToast('Running scheduler...', 'info')
    try {
      const res = await fetch('/api/scheduler/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        const lastLine = data.output?.trim().split('\n').pop() || 'Scheduler complete'
        queue.refresh()
        refreshSessions()
        addToast(lastLine, 'success')
      } else {
        addToast('Scheduler failed', 'error')
      }
    } catch {
      addToast('Failed to run scheduler', 'error')
    }
  }

  async function handleTrainProfile() {
    addToast('Training profile from latest session...', 'info')
    try {
      const res = await fetch('/api/training/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastN: 30 }),
      })
      if (res.ok) {
        const data = await res.json()
        const lastLine = data.output?.trim().split('\n').pop() || 'Training complete'
        addToast(lastLine, 'success')
      } else {
        addToast('Training failed', 'error')
      }
    } catch {
      addToast('Failed to train profile', 'error')
    }
  }

  async function handleAutoRecover() {
    const zombies = sessions.filter(s => s.state === 'zombie')
    if (zombies.length === 0) return
    addToast(`Recovering ${zombies.length} zombie session${zombies.length !== 1 ? 's' : ''}...`, 'info')
    try {
      const res = await fetch('/api/health/recover', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        addToast('Recovery complete', 'success')
      } else {
        addToast(`Recovery issue: ${data.error || 'unknown'}`, 'error')
      }
    } catch {
      // Fallback to per-session reconnect
      for (const z of zombies) {
        try {
          await fetch('/api/sessions/reconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd: z.cwd }),
          })
        } catch { /* continue */ }
      }
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
        workersActiveCount={sessions.filter(s => s.state === 'thinking' || s.state === 'responding').length}
        zombieCount={zombieCount}
        activityCount={history.length}
        activitySparkline={activitySparkline}
        healthIssues={healthIssues}
        lastUpdated={queue.lastUpdated}
        theme={theme}
        onThemeToggle={toggleTheme}
        onSettingsClick={() => setSettingsOpen(true)}
        onSessionsClick={() => setShowSessions(true)}
        onActivityFeedClick={() => setShowActivityFeed(true)}
        onHealthClick={() => setShowHealthPanel(true)}
        onDiscoverClick={handleDiscoverWork}
        orchestratorPaused={orchestratorPaused}
        onPauseToggle={handlePauseToggle}
      />
      <main ref={mainRef} id="main-content" className={`${styles.Main}${viewMode === 'kanban' && activeTab === 'projects' ? ` ${styles.MainNoScroll}` : ''}`}>
        <ErrorBoundary fallbackLabel="The main content area crashed. Try refreshing the page.">
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        {activeTab === 'scheduler-log' ? (
          <SchedulerLog />
        ) : activeTab === 'analytics' ? (
          <AnalyticsView items={queue.items} sessions={sessions} delegators={delegatorData.delegators} events={orchestratorEvents} />
        ) : activeTab === 'delegators' ? (
          <DelegatorPanel
            delegators={delegatorData.delegators}
            loading={delegatorData.loading}
            items={queue.items}
            onRefresh={delegatorData.refresh}
            onSendMessage={actions.handleSendMessage}
          />
        ) : activeTab === 'sessions' ? (
          <SessionsView
            sessions={sessions}
            items={queue.items}
            messagesBySession={actions.messagesBySession}
            onSendMessage={actions.handleSendMessage}
            onKillSession={actions.handleKillSession}
            onReconnectSession={actions.handleReconnectSession}
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
            />
            <Breadcrumb
              tab={activeTab}
              searchQuery={debouncedSearch.trim() || undefined}
              statusFilter={statusFilter.size === 5 ? undefined : Array.from(statusFilter).join(', ')}
              viewMode={viewMode}
              itemCount={filteredItems.length}
            />
            <div className={styles.ControlsRow}>
              <FilterChips
                activeStatuses={statusFilter}
                counts={{
                  active: queue.activeItems.length,
                  planning: queue.planningItems.length,
                  queued: queue.queuedItems.length,
                  review: queue.reviewItems.length,
                  completed: queue.completedItems.length,
                }}
                onToggle={(status) => {
                  setStatusFilter(prev => {
                    const next = new Set(prev)
                    if (next.has(status)) {
                      next.delete(status)
                    } else {
                      next.add(status)
                    }
                    return next
                  })
                }}
              />
              <SortControls
                sortField={sortField}
                sortDirection={sortDirection}
                onSortChange={(field, direction) => { setSortField(field); setSortDirection(direction) }}
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
              <button
                className={`${styles.AddButton} ${showAddForm ? styles.AddButtonActive : ''}`}
                onClick={() => setShowAddForm(!showAddForm)}
                title={showAddForm ? 'Cancel adding' : 'Add work item'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
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
            <PinnedSection
              items={filteredItems}
              pinnedIds={pinned}
              onTogglePin={togglePin}
              onNavigate={id => setDetailItemId(id)}
            />
            <div key={viewMode} className={styles.ViewTransition}>
            {viewMode === 'compact' ? (
              <CompactList
                items={filteredItems}
                selectable={selectionMode}
                selectedIds={selectedIds}
                onSelect={handleToggleSelect}
                onStatusChange={actions.handleStatusChange}
                onActivateStream={actions.handleActivateStream}
                activatingIds={actions.activatingIds}
                focusedItemId={focusedItemId}
                onNavigate={id => setDetailItemId(id)}
                onReorder={actions.handleReorder}
                onEdit={actions.handleEdit}
              />
            ) : viewMode === 'grouped' ? (
              <GroupedList
                items={filteredItems}
                onStatusChange={actions.handleStatusChange}
                onNavigate={id => setDetailItemId(id)}
              />
            ) : viewMode === 'kanban' ? (
              <div className={styles.KanbanWrapper}>
                <KanbanBoard
                  items={filteredItems}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onStatusChange={actions.handleStatusChange}
                  onNavigate={id => setDetailItemId(id)}
                />
              </div>
            ) : (
            <WorkStreamList
              items={filteredItems}
              loading={queue.loading}
              hasSearch={searchQuery.trim().length > 0}
              sortField={sortField}
              sortDirection={sortDirection}
              sessions={sessions}
              messagesBySession={actions.messagesBySession}
              selectable={selectionMode}
              selectedIds={selectedIds}
              onSelect={handleToggleSelect}
              focusedItemId={focusedItemId}
              onClearFocus={() => setFocusedItemId(null)}
              pinnedIds={pinned}
              onTogglePin={togglePin}
              emptyLabel={
                activeTab === 'projects' ? 'No projects' : undefined
              }
              emptyTab={activeTab}
              onAddClick={() => setShowAddForm(true)}
              onStatusChange={actions.handleStatusChange}
              onPriorityChange={actions.handlePriorityChange}
              onDelegatorToggle={actions.handleDelegatorToggle}
              onEdit={actions.handleEdit}
              onDelete={actions.handleDelete}
              onDuplicate={actions.handleDuplicate}
              onActivateStream={actions.handleActivateStream}
              onTeardownStream={actions.handleTeardownStream}
              activatingIds={actions.activatingIds}
              tearingDownIds={actions.tearingDownIds}
              onPrUrlChange={actions.handlePrUrlChange}
              onGeneratePlan={actions.handleGeneratePlan}
              onReorder={actions.handleReorder}
              onSendMessage={actions.handleSendMessage}
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
        latencyMs={queue.latencyMs}
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
      {actions.confirmAction && (
        <ConfirmDialog
          title={actions.confirmAction.title}
          message={actions.confirmAction.message}
          confirmLabel={actions.confirmAction.confirmLabel}
          danger={actions.confirmAction.danger}
          onConfirm={actions.confirmAction.onConfirm}
          onCancel={() => actions.setConfirmAction(null)}
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
          onClipboardImport={async (items) => {
            let imported = 0
            for (const item of items) {
              try {
                await fetch('/api/queue/add', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: item.title,
                    description: item.description || '',
                    type: item.type || 'quick_fix',
                    priority: item.priority ?? 50,
                    branch: '',
                  }),
                })
                imported++
              } catch { /* continue */ }
            }
            queue.refresh()
            addToast(`Imported ${imported} item${imported !== 1 ? 's' : ''} from clipboard`, 'success')
          }}
        />
      )}
      {showActivityFeed && (
        <ActivityFeed
          history={history}
          events={orchestratorEvents}
          onClear={clearHistory}
          onClose={() => setShowActivityFeed(false)}
        />
      )}
      {showSessions && (
        <SessionsPanel
          sessions={sessions}
          messagesBySession={actions.messagesBySession}
          onClose={() => setShowSessions(false)}
          onSendMessage={actions.handleSendMessage}
        />
      )}
      {detailItemId && (() => {
        const detailItem = queue.items.find(i => i.id === detailItemId)
        if (!detailItem) return null
        return (
          <DetailPanel
            item={detailItem}
            allItems={queue.items}
            sessions={sessions}
            delegator={delegatorData.delegators.find(d => d.item_id === detailItemId)}
            onClose={() => setDetailItemId(null)}
            onStatusChange={(id, status) => { actions.handleStatusChange(id, status); setDetailItemId(null) }}
            onDelete={(id) => { actions.handleDelete(id); setDetailItemId(null) }}
            onDuplicate={(id) => { actions.handleDuplicate(id); setDetailItemId(null) }}
            onUpdate={async (id, fields) => {
              try {
                await fetch('/api/queue/update', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id, ...fields }),
                })
                queue.refresh()
                addToast('Updated', 'success')
              } catch {
                addToast('Failed to update', 'error')
              }
            }}
            onNotesChange={async (id, notes) => {
              try {
                await fetch('/api/queue/update', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id, metadata: { notes } }),
                })
                queue.refresh()
                addToast('Notes updated', 'success')
              } catch {
                addToast('Failed to save notes', 'error')
              }
            }}
            onActivateStream={actions.handleActivateStream}
            onTeardownStream={actions.handleTeardownStream}
            onSendMessage={actions.handleSendMessage}
            onDelegatorToggle={actions.handleDelegatorToggle}
            onGeneratePlan={actions.handleGeneratePlan}
            onRefresh={() => queue.refresh()}
            onUpdateBlockedBy={queue.updateBlockedBy}
          />
        )
      })()}
      {showCommandPalette && (
        <CommandPalette
          items={queue.items}
          sessionsWithItems={sessionsWithItems}
          onClose={() => setShowCommandPalette(false)}
          onNavigateToItem={handleNavigateToItem}
          onStatusChange={actions.handleStatusChange}
          onAddItem={() => setShowAddForm(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onRefresh={() => { queue.refresh(); addToast('Queue refreshed', 'info') }}
          onToggleTheme={toggleTheme}
          onMessageSession={(sessionId) => {
            setShowCommandPalette(false)
            const text = prompt(`Message to session ${sessionId.slice(0, 8)}:`)
            if (text) actions.handleSendMessage(sessionId, text)
          }}
          onGoToSessions={() => setActiveTab('sessions')}
          onToggleViewMode={() => setViewMode(prev => prev === 'cards' ? 'compact' : prev === 'compact' ? 'grouped' : prev === 'grouped' ? 'kanban' : 'cards')}
          onDiscoverWork={handleDiscoverWork}
          onHealthCheck={() => setShowHealthPanel(true)}
          onActivateStream={actions.handleActivateStream}
          onRunScheduler={handleRunScheduler}
          onTrainProfile={handleTrainProfile}
        />
      )}
      {showHealthPanel && (
        <HealthPanel
          onClose={() => setShowHealthPanel(false)}
          onAutoRecover={handleAutoRecover}
        />
      )}
      {showDiscoverPanel && (
        <DiscoverPanel
          onClose={() => setShowDiscoverPanel(false)}
          onQueueRefresh={queue.refresh}
        />
      )}
      {showShortcuts && (
        <ShortcutSheet onClose={() => setShowShortcuts(false)} />
      )}
      {showGlobalSearch && (
        <GlobalSearch
          items={queue.items}
          sessions={sessions}
          onClose={() => setShowGlobalSearch(false)}
          onNavigateToItem={(id) => { handleNavigateToItem(id); setDetailItemId(id) }}
          onNavigateToSession={() => setActiveTab('sessions')}
        />
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
      <BreakpointIndicator />
    </div>
  )
}
