import { useState, useRef, useEffect } from 'react'
import styles from './Popover.module.scss'

interface Props {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number
}

export function Popover({ trigger, children, align = 'left', width }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const alignClass = align === 'right' ? styles.AlignRight
    : align === 'center' ? styles.AlignCenter
    : styles.AlignLeft

  return (
    <div ref={rootRef} className={styles.Root}>
      <button
        className={styles.Trigger}
        onClick={() => setOpen(!open)}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open && (
        <div className={`${styles.Content} ${alignClass}`} style={width ? { width } : undefined}>
          {children}
        </div>
      )}
    </div>
  )
}
