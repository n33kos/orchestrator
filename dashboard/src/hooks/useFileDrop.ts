import { useState, useEffect, useCallback } from 'react'

interface FileDropOptions {
  accept?: string[]
  onDrop: (file: File) => void
}

export function useFileDrop({ accept = ['.json'], onDrop }: FileDropOptions) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(prev => prev + 1)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(prev => {
      const next = prev - 1
      if (next <= 0) setIsDraggingOver(false)
      return Math.max(0, next)
    })
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    setDragCounter(0)

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const file = files[0]
    const ext = file.name.slice(file.name.lastIndexOf('.'))
    if (accept.length > 0 && !accept.includes(ext)) return

    onDrop(file)
  }, [accept, onDrop])

  useEffect(() => {
    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  return { isDraggingOver }
}
