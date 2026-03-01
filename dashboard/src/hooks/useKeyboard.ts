import { useEffect } from 'react'

interface KeyboardActions {
  onNewItem?: () => void
  onFocusSearch?: () => void
  onEscape?: () => void
  onRefresh?: () => void
  onCommandPalette?: () => void
  onTabSwitch?: (index: number) => void
  onSelectAll?: () => void
  onToggleViewMode?: () => void
  onNavigateDown?: () => void
  onNavigateUp?: () => void
  onOpenFocused?: () => void
  onShowShortcuts?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomReset?: () => void
}

export function useKeyboard({ onNewItem, onFocusSearch, onEscape, onRefresh, onCommandPalette, onTabSwitch, onSelectAll, onToggleViewMode, onNavigateDown, onNavigateUp, onOpenFocused, onShowShortcuts, onZoomIn, onZoomOut, onZoomReset }: KeyboardActions) {
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

      // Zoom controls (work in inputs too)
      if ((e.key === '=' || e.key === '+') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onZoomIn?.()
        return
      }
      if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onZoomOut?.()
        return
      }
      if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onZoomReset?.()
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

      // Number keys 1-4 switch tabs
      if (['1', '2', '3', '4'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onTabSwitch?.(parseInt(e.key, 10) - 1)
      }

      // Cmd+A / Ctrl+A to toggle select all (when not in input)
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onSelectAll?.()
      }

      // V to toggle view mode
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onToggleViewMode?.()
      }

      // J/K for vim-style navigation
      if (e.key === 'j' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onNavigateDown?.()
      }

      if (e.key === 'k' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onNavigateUp?.()
      }

      // Enter to open focused item
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onOpenFocused?.()
      }

      // ? to show shortcuts sheet
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onShowShortcuts?.()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onNewItem, onFocusSearch, onEscape, onRefresh, onCommandPalette, onTabSwitch, onSelectAll, onToggleViewMode, onNavigateDown, onNavigateUp, onOpenFocused, onShowShortcuts, onZoomIn, onZoomOut, onZoomReset])
}
