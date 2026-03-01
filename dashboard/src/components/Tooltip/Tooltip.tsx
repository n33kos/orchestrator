import { useState, useRef, useEffect } from 'react'
import styles from './Tooltip.module.scss'

interface Props {
  content: string
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

export function Tooltip({ content, children, position = 'top', delay = 300 }: Props) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  function handleEnter() {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      let x = 0
      let y = 0

      switch (position) {
        case 'top':
          x = rect.left + rect.width / 2
          y = rect.top - 6
          break
        case 'bottom':
          x = rect.left + rect.width / 2
          y = rect.bottom + 6
          break
        case 'left':
          x = rect.left - 6
          y = rect.top + rect.height / 2
          break
        case 'right':
          x = rect.right + 6
          y = rect.top + rect.height / 2
          break
      }

      setCoords({ x, y })
      setVisible(true)
    }, delay)
  }

  function handleLeave() {
    clearTimeout(timerRef.current)
    setVisible(false)
  }

  const posClass = position === 'top' ? styles.Top :
    position === 'bottom' ? styles.Bottom :
    position === 'left' ? styles.Left : styles.Right

  return (
    <span
      ref={triggerRef}
      className={styles.Trigger}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {visible && (
        <span
          className={`${styles.Tip} ${posClass}`}
          style={{ left: coords.x, top: coords.y }}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  )
}
