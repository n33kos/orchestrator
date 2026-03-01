import { useState, useEffect, useCallback, useRef } from 'react'
import type { SessionInfo } from '../types.ts'

export function useSessions(pollIntervalMs = 10000) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions ?? [])
      }
    } catch {
      // vmux not available
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    pollRef.current = setInterval(fetchSessions, pollIntervalMs)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchSessions, pollIntervalMs])

  const sendMessage = useCallback(async (sessionId: string, text: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/sessions/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
      })
      return res.ok
    } catch {
      return false
    }
  }, [])

  const getSessionForPath = useCallback((worktreePath: string | null): SessionInfo | undefined => {
    if (!worktreePath) return undefined
    return sessions.find(s => s.cwd === worktreePath || worktreePath.startsWith(s.cwd))
  }, [sessions])

  const getSessionById = useCallback((sessionId: string | null): SessionInfo | undefined => {
    if (!sessionId) return undefined
    return sessions.find(s => s.id === sessionId)
  }, [sessions])

  return { sessions, sendMessage, getSessionForPath, getSessionById, refresh: fetchSessions }
}
