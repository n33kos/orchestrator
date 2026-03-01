import { useState, useRef, useCallback, useEffect } from 'react'
import styles from './ResizablePanel.module.scss'

interface Props {
  children: React.ReactNode
  initialWidth?: number
  minWidth?: number
  maxWidth?: number
  side?: 'left' | 'right'
  className?: string
}

export function ResizablePanel({
  children,
  initialWidth = 300,
  minWidth = 200,
  maxWidth = 600,
  side = 'right',
  className,
}: Props) {
  const [width, setWidth] = useState(initialWidth)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = side === 'right'
        ? startX.current - e.clientX
        : e.clientX - startX.current
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta))
      setWidth(newWidth)
    }

    function handleMouseUp() {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [side, minWidth, maxWidth])

  return (
    <div className={`${styles.Root} ${className ?? ''}`} style={{ width }}>
      <div
        className={`${styles.Handle} ${side === 'left' ? styles.HandleLeft : styles.HandleRight}`}
        onMouseDown={handleMouseDown}
      />
      <div className={styles.Content}>
        {children}
      </div>
    </div>
  )
}
