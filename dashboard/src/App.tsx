import { useState, useMemo, useRef, useCallback } from 'react'
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
import { CompactList } from './components/CompactList/CompactList.tsx'
import { DetailPanel } from './components/DetailPanel/DetailPanel.tsx'
import { FilterChips } from './components/FilterChips/FilterChips.tsx'
import { KeyboardHints } from './components/KeyboardHints/KeyboardHints.tsx'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.tsx'
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
import { usePinnedItems } from './hooks/usePinnedItems.ts'
import type { WorkItemStatus, MessageEntry } from './types.ts'

export function App() {
  const { settings, update: updateSetting, reset: resetSettings, open: settingsOpen, setOpen: setSettingsOpen } = useSettings()
  const queue = useQueue(settings.pollIntervalMs)
  const { theme, toggle: toggleTheme } = useTheme()
  const { toasts, history, addToast, dismissToast, clearHistory } = useToast()
  const activitySparkline = useActivitySparkline(history)
  const { pinned, togglePin } = usePinnedItems()
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
  const [activeTab, setActiveTab] = usePersistedState('activeTab', 'projects')
  const [showAddForm, setShowAddForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 200)
  const [showCompleted, setShowCompleted] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showActivityFeed, setShowActivityFeed] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const [viewMode, setViewMode] = usePersistedState<'cards' | 'compact'>('viewMode', 'cards')
  const [sortField, setSortField] = usePersistedState<SortField>('sortField', 'priority')
  const [sortDirection, setSortDirection] = usePersistedState<SortDirection>('sortDirection', 'asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)

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
      if (showCommandPalette) { setShowCommandPalette(false); return }
      if (detailItemId) { setDetailItemId(null); return }
      if (showActivityFeed) { setShowActivityFeed(false); return }
      if (showSessions) { setShowSessions(false); return }
      if (settingsOpen) { setSettingsOpen(false); return }
      if (confirmAction) { setConfirmAction(null); return }
      if (selectionMode) { setSelectedIds(new Set()); setSelectionMode(false); return }
      if (showAddForm) { setShowAddForm(false); return }
      if (searchQuery) { setSearchQuery(''); return }
    }, [showCommandPalette, detailItemId, showActivityFeed, showSessions, settingsOpen, confirmAction, selectionMode, showAddForm, searchQuery, setSettingsOpen]),
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
      setViewMode(prev => prev === 'cards' ? 'compact' : 'cards')
    }, [setViewMode]),
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

  return (
    <div className={styles.Root}>
      <Header
        activeCount={queue.activeItems.length}
        queuedCount={queue.queuedItems.length}
        pausedCount={queue.pausedItems.length}
        blockedCount={queue.blockedItems.length}
        sessionCount={sessions.length}
        activityCount={history.length}
        activitySparkline={activitySparkline}
        lastUpdated={queue.lastUpdated}
        onAddClick={() => setShowAddForm(!showAddForm)}
        showingAddForm={showAddForm}
        theme={theme}
        onThemeToggle={toggleTheme}
        onSettingsClick={() => setSettingsOpen(true)}
        onSessionsClick={() => setShowSessions(true)}
        onActivityFeedClick={() => setShowActivityFeed(true)}
      />
      <main ref={mainRef} className={styles.Main}>
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
            <SearchBar ref={searchRef} value={searchQuery} onChange={setSearchQuery} resultCount={debouncedSearch.trim() ? filteredItems.length : undefined} />
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
                onClick={() => setViewMode(viewMode === 'cards' ? 'compact' : 'cards')}
                title={viewMode === 'cards' ? 'Switch to compact view' : 'Switch to card view'}
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
            {viewMode === 'compact' ? (
              <CompactList
                items={filteredItems}
                selectable={selectionMode}
                selectedIds={selectedIds}
                onSelect={handleToggleSelect}
                onStatusChange={handleStatusChange}
                onNavigate={id => setDetailItemId(id)}
                onReorder={handleReorder}
                onEdit={handleEdit}
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
              onReorder={handleReorder}
              onSendMessage={handleSendMessage}
            />
            )}
          </>
        )}
        </ErrorBoundary>
      </main>
      {selectionMode && selectedIds.size > 0 && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          onStatusChange={handleBatchStatusChange}
          onDelete={handleBatchDelete}
          onClearSelection={handleClearSelection}
        />
      )}
      <KeyboardHints />
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
          onToggleViewMode={() => setViewMode(prev => prev === 'cards' ? 'compact' : 'cards')}
        />
      )}
    </div>
  )
}
