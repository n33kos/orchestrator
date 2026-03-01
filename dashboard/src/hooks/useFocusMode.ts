import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'orchestrator:focusMode'

export function useFocusMode() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(enabled))
    if (enabled) {
      document.body.classList.add('focus-mode')
    } else {
      document.body.classList.remove('focus-mode')
    }
    return () => document.body.classList.remove('focus-mode')
  }, [enabled])

  const toggle = useCallback(() => setEnabled(prev => !prev), [])

  return { focusMode: enabled, toggleFocusMode: toggle }
}
