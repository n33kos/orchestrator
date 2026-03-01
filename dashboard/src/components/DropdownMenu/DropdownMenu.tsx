import { useState, useRef, useEffect } from 'react'
import styles from './DropdownMenu.module.scss'

export interface MenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  divider?: boolean
}

interface Props {
  items: MenuItem[]
  onSelect: (id: string) => void
  trigger: React.ReactNode
  align?: 'left' | 'right'
}

export function DropdownMenu({ items, onSelect, trigger, align = 'left' }: Props) {
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

  return (
    <div ref={rootRef} className={styles.Root}>
      <button
        className={styles.Trigger}
        onClick={() => setOpen(!open)}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open && (
        <div className={`${styles.Menu} ${align === 'right' ? styles.AlignRight : styles.AlignLeft}`} role="menu">
          {items.map(item => {
            if (item.divider) {
              return <div key={item.id} className={styles.Divider} role="separator" />
            }
            return (
              <button
                key={item.id}
                role="menuitem"
                className={`${styles.Item} ${item.danger ? styles.Danger : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  onSelect(item.id)
                  setOpen(false)
                }}
                type="button"
              >
                {item.icon && <span className={styles.Icon}>{item.icon}</span>}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
