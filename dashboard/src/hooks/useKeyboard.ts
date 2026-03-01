import { useEffect } from 'react'

interface KeyboardActions {
  onNewItem?: () => void
  onFocusSearch?: () => void
  onEscape?: () => void
  onRefresh?: () => void
  onCommandPalette?: () => void
}

export function useKeyboard({ onNewItem, onFocusSearch, onEscape, onRefresh, onCommandPalette }: KeyboardActions) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Cmd+K / Ctrl+K always works (even in inputs)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onCommandPalette?.()
        return
      }

      if (e.key === 'Escape') {
        onEscape?.()
        return
      }

      // Don't capture when typing in inputs
      if (isInput) return

      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onNewItem?.()
      }

      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onFocusSearch?.()
      }

      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onRefresh?.()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onNewItem, onFocusSearch, onEscape, onRefresh, onCommandPalette])
}
