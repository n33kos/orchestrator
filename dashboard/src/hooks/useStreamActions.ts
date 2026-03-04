import { useState, useCallback } from 'react'
import type { WorkItemStatus, WorkItem, MessageEntry, SessionInfo } from '../types.ts'

interface UseStreamActionsOptions {
  items: WorkItem[]
  sessions: SessionInfo[]
  updateItem: (id: string, updates: { status?: WorkItemStatus; priority?: number; delegator_enabled?: boolean; title?: string; description?: string; pr_url?: string | null }) => void
  deleteItem: (id: string) => void
  reorderItems: (dragId: string, dropId: string) => void
  refresh: () => void
  refreshSessions: () => void
  sendMessage: (sessionId: string, text: string) => Promise<boolean>
  addToast: (message: string, type: 'info' | 'success' | 'warning' | 'error', action?: { label: string; onClick: () => void }) => void
}

export function useStreamActions({
  items,
  sessions,
  updateItem,
  deleteItem,
  reorderItems,
  refresh,
  refreshSessions,
  sendMessage,
  addToast,
}: UseStreamActionsOptions) {
  const [activatingIds, setActivatingIds] = useState<Set<string>>(new Set())
  const [tearingDownIds, setTearingDownIds] = useState<Set<string>>(new Set())
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, MessageEntry[]>>({})

  const handleStatusChange = useCallback((id: string, status: WorkItemStatus) => {
    const item = items.find(i => i.id === id)
    const previousStatus = item?.status
    const hasSession = !!item?.session_id
    const labels: Record<string, string> = {
      active: 'activated',
      paused: 'paused',
      completed: 'completed',
      queued: 'queued',
      review: 'moved to review',
      planning: 'moved to planning',
    }

    // Suspend session when moving active -> review or active -> paused
    if ((status === 'review' || status === 'paused') && previousStatus === 'active' && hasSession) {
      const label = status === 'review' ? 'review' : 'paused'
      addToast(`Suspending session (${label})...`, 'info')
      fetch('/api/stream/suspend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id, targetStatus: status }),
      }).then(res => {
        if (res.ok) {
          refresh()
          addToast(`${status === 'review' ? 'Moved to review' : 'Paused'} — session suspended`, 'success')
        } else {
          updateItem(id, { status })
          addToast(`${status === 'review' ? 'Moved to review' : 'Paused'} (session suspend failed)`, 'warning')
        }
      }).catch(() => {
        updateItem(id, { status })
      })
      return
    }

    // Resume session when moving review -> active
    if (status === 'active' && (previousStatus === 'review' || previousStatus === 'paused') && item?.worktree_path && !hasSession) {
      addToast('Resuming session...', 'info')
      fetch('/api/stream/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id }),
      }).then(res => {
        if (res.ok) {
          refresh()
          addToast('Resumed — session respawned', 'success')
        } else {
          updateItem(id, { status })
          addToast('Resumed (session respawn failed)', 'warning')
        }
      }).catch(() => {
        updateItem(id, { status })
      })
      return
    }

    // Default: just update the status
    updateItem(id, { status })
    addToast(
      `Work item ${labels[status] || status}`,
      'success',
      previousStatus ? {
        label: 'Undo',
        onClick: () => {
          updateItem(id, { status: previousStatus })
          addToast('Status change reverted', 'info')
        },
      } : undefined,
    )
  }, [items, updateItem, refresh, addToast])

  const handlePriorityChange = useCallback((id: string, priority: number) => {
    updateItem(id, { priority })
  }, [updateItem])

  const handleEdit = useCallback((id: string, updates: { title?: string; description?: string }) => {
    updateItem(id, updates)
    addToast('Work item updated', 'success')
  }, [updateItem, addToast])

  const handleDelegatorToggle = useCallback(async (id: string, enabled: boolean) => {
    updateItem(id, { delegator_enabled: enabled })
    const item = items.find(i => i.id === id)
    if (item?.status === 'active' && enabled && !item.delegator_id) {
      addToast('Spawning delegator...', 'info')
      try {
        const res = await fetch('/api/delegators/spawn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: id }),
        })
        if (res.ok) {
          refresh()
          addToast('Delegator spawned', 'success')
        } else {
          addToast('Delegator spawn failed', 'error')
        }
      } catch {
        addToast('Delegator spawn failed', 'error')
      }
    } else {
      addToast(`Delegator ${enabled ? 'enabled' : 'disabled'}`, 'info')
    }
  }, [items, updateItem, refresh, addToast])

  const handleReorder = useCallback((dragId: string, dropId: string) => {
    const dragItem = items.find(i => i.id === dragId)
    if (!dragItem) return
    reorderItems(dragId, dropId)
    addToast(`Reordered "${dragItem.title}"`, 'info')
  }, [items, reorderItems, addToast])

  const handleSendMessage = useCallback(async (sessionId: string, text: string) => {
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
  }, [sendMessage, addToast])

  const handleDuplicate = useCallback(async (id: string) => {
    const item = items.find(i => i.id === id)
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
      refresh()
      addToast('Work item duplicated', 'success')
    } catch {
      addToast('Failed to duplicate work item', 'error')
    }
  }, [items, refresh, addToast])

  const handleDelete = useCallback((id: string) => {
    const item = items.find(i => i.id === id)
    setConfirmAction({
      title: 'Remove Work Item',
      message: `Are you sure you want to remove "${item?.title || id}"? This cannot be undone.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        deleteItem(id)
        setConfirmAction(null)
        addToast('Work item removed', 'success')
      },
    })
  }, [items, deleteItem, addToast])

  const handlePrUrlChange = useCallback((id: string, prUrl: string) => {
    updateItem(id, { pr_url: prUrl || null })
    addToast('PR URL updated', 'success')
  }, [updateItem, addToast])

  const handleGeneratePlan = useCallback(async (id: string) => {
    addToast('Generating plan...', 'info')
    try {
      const res = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id }),
      })
      if (res.ok) {
        refresh()
        addToast('Plan generated — review and approve to activate', 'success')
      } else {
        const data = await res.json()
        addToast(`Plan generation failed: ${data.error || 'Unknown error'}`, 'error')
      }
    } catch {
      addToast('Failed to generate plan', 'error')
    }
  }, [refresh, addToast])

  const handleActivateStream = useCallback(async (id: string) => {
    const item = items.find(i => i.id === id)
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
        refresh()
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
  }, [items, refresh, refreshSessions, addToast])

  const handleTeardownStream = useCallback((id: string) => {
    const item = items.find(i => i.id === id)
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
            refresh()
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
  }, [items, refresh, refreshSessions, addToast])

  const handleKillSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch('/api/sessions/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (res.ok) {
        addToast('Session killed', 'success')
        refreshSessions()
      } else {
        addToast('Failed to kill session', 'error')
      }
    } catch {
      addToast('Failed to kill session', 'error')
    }
  }, [addToast, refreshSessions])

  const handleReconnectSession = useCallback(async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) {
      addToast('Session not found', 'error')
      return
    }
    try {
      const res = await fetch('/api/sessions/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: session.cwd }),
      })
      if (res.ok) {
        addToast('Session reconnecting...', 'info')
      } else {
        addToast('Failed to reconnect session', 'error')
      }
    } catch {
      addToast('Failed to reconnect session', 'error')
    }
  }, [sessions, addToast])

  return {
    activatingIds,
    tearingDownIds,
    confirmAction,
    setConfirmAction,
    messagesBySession,
    handleStatusChange,
    handlePriorityChange,
    handleEdit,
    handleDelegatorToggle,
    handleReorder,
    handleSendMessage,
    handleDuplicate,
    handleDelete,
    handlePrUrlChange,
    handleGeneratePlan,
    handleActivateStream,
    handleTeardownStream,
    handleKillSession,
    handleReconnectSession,
  }
}
