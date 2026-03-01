import { useState, useCallback, useRef } from 'react'
import type { ToastItem } from '../components/Toast/Toast.tsx'

export interface HistoryEntry {
  id: string
  message: string
  type: ToastItem['type']
  timestamp: string
}

const TOAST_DURATION = 3000
const MAX_HISTORY = 50

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const counterRef = useRef(0)

  const addToast = useCallback((message: string, type: ToastItem['type'] = 'info', action?: { label: string; onClick: () => void }) => {
    const id = `toast-${++counterRef.current}`
    setToasts(prev => [...prev, { id, message, type, action }])
    setHistory(prev => [
      { id, message, type, timestamp: new Date().toISOString() },
      ...prev,
    ].slice(0, MAX_HISTORY))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, action ? TOAST_DURATION * 2 : TOAST_DURATION)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  return { toasts, history, addToast, dismissToast, clearHistory }
}
