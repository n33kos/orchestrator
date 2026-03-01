import { useEffect, useRef } from 'react'
import classnames from 'classnames'
import styles from './ContextMenu.module.scss'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: React.JSX.Element
  danger?: boolean
  separator?: boolean
  disabled?: boolean
  action: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Adjust position if menu would overflow viewport
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${y - rect.height}px`
    }
  }, [x, y])

  useEffect(() => {
    function handleClick() { onClose() }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Delay adding click listener to avoid immediate close
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    document.addEventListener('keydown', handleKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className={styles.Root}
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      {items.map(item => {
        if (item.separator) {
          return <div key={item.id} className={styles.Separator} />
        }
        return (
          <button
            key={item.id}
            className={classnames(styles.Item, item.danger && styles.ItemDanger, item.disabled && styles.ItemDisabled)}
            onClick={() => {
              if (!item.disabled) {
                item.action()
                onClose()
              }
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className={styles.ItemIcon}>{item.icon}</span>}
            <span className={styles.ItemLabel}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
