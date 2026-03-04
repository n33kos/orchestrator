import { useState, useEffect, useCallback, useRef } from 'react'
import type { WorkItem, WorkItemStatus } from '../types.ts'

interface UseOrchestratorPollingOptions {
  autoActivate: boolean
  items: WorkItem[]
  refresh: () => void
  refreshSessions: () => void
  updateItem: (id: string, updates: { status?: WorkItemStatus }) => void
  addToast: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void
}

interface OrchestratorPollingState {
  orchestratorPaused: boolean
  healthIssues: number
  handlePauseToggle: () => Promise<void>
}

export function useOrchestratorPolling({
  autoActivate,
  items,
  refresh,
  refreshSessions,
  updateItem,
  addToast,
}: UseOrchestratorPollingOptions): OrchestratorPollingState {
  const [orchestratorPaused, setOrchestratorPaused] = useState(false)
  const [healthIssues, setHealthIssues] = useState(0)

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

  // Fetch pause state on mount
  useEffect(() => {
    fetch('/api/orchestrator/pause')
      .then(r => r.json())
      .then(data => setOrchestratorPaused(data.paused))
      .catch(() => {})
  }, [])

  // Auto-scheduler: when auto-activate is enabled, periodically run the scheduler
  useEffect(() => {
    if (!autoActivate) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/scheduler/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (res.ok) {
          const data = await res.json()
          const output = data.output?.trim() || ''
          if (output.includes('Activated') || output.includes('activated')) {
            refresh()
            refreshSessions()
            addToast(output.split('\n').pop() || 'Auto-activated work item', 'success')
          }
        }
      } catch { /* ignore */ }
    }, 30000)
    return () => clearInterval(interval)
  }, [autoActivate, refresh, refreshSessions, addToast])

  // PR status polling: auto-complete work items when their PR is merged
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  useEffect(() => {
    const interval = setInterval(async () => {
      const itemsWithPr = itemsRef.current.filter(i => i.pr_url && i.status === 'active')
      for (const item of itemsWithPr) {
        try {
          const url = encodeURIComponent(item.pr_url!)
          const res = await fetch(`/api/pr-status?url=${url}`)
          if (res.ok) {
            const data = await res.json()
            if (data.state === 'MERGED' && item.status !== 'completed') {
              updateItem(item.id, { status: 'completed' })
              addToast(`"${item.title}" auto-completed — PR merged`, 'success')
            }
          }
        } catch { /* ignore */ }
      }
    }, 120000)
    return () => clearInterval(interval)
  }, [updateItem, addToast])

  const handlePauseToggle = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestrator/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !orchestratorPaused }),
      })
      const data = await res.json()
      setOrchestratorPaused(data.paused)
      addToast(data.message || (data.paused ? 'Paused' : 'Resumed'), data.paused ? 'warning' : 'success')
    } catch {
      addToast('Failed to toggle pause', 'error')
    }
  }, [orchestratorPaused, addToast])

  return {
    orchestratorPaused,
    healthIssues,
    handlePauseToggle,
  }
}
