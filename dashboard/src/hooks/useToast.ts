import { useState, useCallback, useRef } from 'react'
import type { ToastItem } from '../components/Toast/Toast.tsx'

const TOAST_DURATION = 3000

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const addToast = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = `toast-${++counterRef.current}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, TOAST_DURATION)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, dismissToast }
}
