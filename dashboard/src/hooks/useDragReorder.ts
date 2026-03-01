import { useState, useCallback, useRef } from 'react'

interface DragState {
  dragId: string | null
  overId: string | null
}

export function useDragReorder(onReorder: (dragId: string, dropId: string) => void) {
  const [dragState, setDragState] = useState<DragState>({ dragId: null, overId: null })
  const dragRef = useRef<string | null>(null)

  const handleDragStart = useCallback((id: string) => {
    dragRef.current = id
    setDragState({ dragId: id, overId: null })
  }, [])

  const handleDragOver = useCallback((id: string) => {
    if (dragRef.current && dragRef.current !== id) {
      setDragState(prev => ({ ...prev, overId: id }))
    }
  }, [])

  const handleDrop = useCallback((id: string) => {
    if (dragRef.current && dragRef.current !== id) {
      onReorder(dragRef.current, id)
    }
    dragRef.current = null
    setDragState({ dragId: null, overId: null })
  }, [onReorder])

  const handleDragEnd = useCallback(() => {
    dragRef.current = null
    setDragState({ dragId: null, overId: null })
  }, [])

  return {
    dragId: dragState.dragId,
    overId: dragState.overId,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  }
}
