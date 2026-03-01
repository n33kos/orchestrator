import { useState, useCallback } from 'react'

interface UndoEntry {
  id: string
  label: string
  undo: () => void
  timestamp: number
}

const MAX_UNDO = 20
const UNDO_TTL = 30_000 // 30 seconds

export function useUndoStack() {
  const [stack, setStack] = useState<UndoEntry[]>([])

  const push = useCallback((label: string, undo: () => void) => {
    const entry: UndoEntry = {
      id: `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label,
      undo,
      timestamp: Date.now(),
    }
    setStack(prev => [entry, ...prev].slice(0, MAX_UNDO))
  }, [])

  const pop = useCallback(() => {
    setStack(prev => {
      // Filter expired entries first
      const now = Date.now()
      const valid = prev.filter(e => now - e.timestamp < UNDO_TTL)
      if (valid.length === 0) return []
      const [top, ...rest] = valid
      top.undo()
      return rest
    })
  }, [])

  const clear = useCallback(() => setStack([]), [])

  // Only return non-expired entries
  const validStack = stack.filter(e => Date.now() - e.timestamp < UNDO_TTL)

  return {
    stack: validStack,
    canUndo: validStack.length > 0,
    push,
    pop,
    clear,
  }
}
