import { useEffect, useRef } from 'react'
import styles from './CollapsibleSidebar.module.scss'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  side?: 'left' | 'right'
  width?: number
}

export function CollapsibleSidebar({ open, onClose, title, children, side = 'right', width = 340 }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open, onClose])

  return (
    <div className={`${styles.Overlay} ${open ? styles.OverlayOpen : ''}`}>
      <div
        ref={panelRef}
        className={`${styles.Panel} ${open ? styles.PanelOpen : ''} ${side === 'left' ? styles.PanelLeft : styles.PanelRight}`}
        style={{ width }}
      >
        <div className={styles.Header}>
          <h3 className={styles.Title}>{title}</h3>
          <button className={styles.Close} onClick={onClose} aria-label="Close sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.Content}>
          {children}
        </div>
      </div>
    </div>
  )
}
