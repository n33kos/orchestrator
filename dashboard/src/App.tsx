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
import { KeyboardHints } from './components/KeyboardHints/KeyboardHints.tsx'
import type { NewWorkItem } from './components/AddWorkItem/AddWorkItem.tsx'
import { useQueue } from './hooks/useQueue.ts'
import { useTheme } from './hooks/useTheme.ts'
import { useToast } from './hooks/useToast.ts'
import { useKeyboard } from './hooks/useKeyboard.ts'
import { useSettings } from './hooks/useSettings.ts'
import { useNotifications } from './hooks/useNotifications.ts'
import { useSessions } from './hooks/useSessions.ts'
import type { WorkItemStatus, MessageEntry } from './types.ts'

export function App() {
  const { settings, update: updateSetting, reset: resetSettings, open: settingsOpen, setOpen: setSettingsOpen } = useSettings()
  const queue = useQueue(settings.pollIntervalMs)
  const { theme, toggle: toggleTheme } = useTheme()
  const { toasts, addToast, dismissToast } = useToast()
  useNotifications(queue.items, settings.notificationsEnabled)
  const { sessions, sendMessage } = useSessions()
  const [messagesBySession, setMessagesBySession] = useState<Record<string, MessageEntry[]>>({})
  const [activeTab, setActiveTab] = useState('projects')
  const [showAddForm, setShowAddForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [sortField, setSortField] = useState<SortField>('priority')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)

  useKeyboard({
    onNewItem: useCallback(() => setShowAddForm(true), []),
    onFocusSearch: useCallback(() => searchRef.current?.focus(), []),
    onEscape: useCallback(() => {
      if (showCommandPalette) { setShowCommandPalette(false); return }
      if (showSessions) { setShowSessions(false); return }
      if (settingsOpen) { setSettingsOpen(false); return }
      if (confirmAction) { setConfirmAction(null); return }
      if (showAddForm) { setShowAddForm(false); return }
      if (searchQuery) { setSearchQuery(''); return }
    }, [showCommandPalette, showSessions, settingsOpen, confirmAction, showAddForm, searchQuery, setSettingsOpen]),
    onRefresh: useCallback(() => {
      queue.refresh()
      addToast('Queue refreshed', 'info')
    }, [queue, addToast]),
    onCommandPalette: useCallback(() => setShowCommandPalette(prev => !prev), []),
  })

  const tabs = [
    { id: 'projects', label: 'Projects', count: queue.projects.length },
    { id: 'quick_fixes', label: 'Quick Fixes', count: queue.quickFixes.length },
    { id: 'all', label: 'All', count: queue.items.length },
  ]

  const filteredItems = useMemo(() => {
    let pool = activeTab === 'projects'
      ? queue.projects
      : activeTab === 'quick_fixes'
        ? queue.quickFixes
        : queue.items

    if (!showCompleted) {
      pool = pool.filter(i => i.status !== 'completed')
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'blocked') {
        pool = pool.filter(i => i.blockers.some(b => !b.resolved))
      } else {
        pool = pool.filter(i => i.status === statusFilter)
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      pool = pool.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.branch.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      )
    }

    return pool
  }, [activeTab, queue.projects, queue.quickFixes, queue.items, searchQuery, showCompleted, statusFilter])

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
    const labels: Record<string, string> = {
      active: 'activated',
      paused: 'paused',
      completed: 'completed',
      queued: 'queued',
      review: 'moved to review',
    }
    queue.updateItem(id, { status })
    addToast(`Work item ${labels[status] || status}`, 'success')
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
        lastUpdated={queue.lastUpdated}
        onAddClick={() => setShowAddForm(!showAddForm)}
        showingAddForm={showAddForm}
        theme={theme}
        onThemeToggle={toggleTheme}
        onSettingsClick={() => setSettingsOpen(true)}
        onSessionsClick={() => setShowSessions(true)}
      />
      <main className={styles.Main}>
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        <SearchBar ref={searchRef} value={searchQuery} onChange={setSearchQuery} />
        <StatsBar
          totalItems={queue.items.length}
          activeCount={queue.activeItems.length}
          queuedCount={queue.queuedItems.length}
          completedCount={queue.completedItems.length}
          blockedCount={queue.blockedItems.length}
          showCompleted={showCompleted}
          onToggleCompleted={() => setShowCompleted(!showCompleted)}
        />
        <SortControls
          sortField={sortField}
          sortDirection={sortDirection}
          statusFilter={statusFilter}
          onSortChange={(field, direction) => { setSortField(field); setSortDirection(direction) }}
          onStatusFilterChange={setStatusFilter}
        />
        {showAddForm && (
          <AddWorkItem
            onAdd={handleAddItem}
            onCancel={() => setShowAddForm(false)}
          />
        )}
        <WorkStreamList
          items={filteredItems}
          loading={queue.loading}
          hasSearch={searchQuery.trim().length > 0}
          sortField={sortField}
          sortDirection={sortDirection}
          sessions={sessions}
          messagesBySession={messagesBySession}
          emptyLabel={
            activeTab === 'quick_fixes' ? 'No quick fixes' :
            activeTab === 'projects' ? 'No projects' : undefined
          }
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onDelegatorToggle={handleDelegatorToggle}
          onEdit={handleEdit}
          onAddBlocker={handleAddBlocker}
          onResolveBlocker={handleResolveBlocker}
          onUnresolveBlocker={handleUnresolveBlocker}
          onDelete={handleDelete}
          onReorder={handleReorder}
          onSendMessage={handleSendMessage}
        />
      </main>
      <KeyboardHints />
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
      {showCommandPalette && (
        <CommandPalette
          items={queue.items}
          sessionsWithItems={sessionsWithItems}
          onClose={() => setShowCommandPalette(false)}
          onNavigateToItem={() => {}}
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
        />
      )}
    </div>
  )
}
