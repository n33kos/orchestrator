import { useState } from 'react'
import styles from './Accordion.module.scss'

interface AccordionItem {
  id: string
  title: string
  content: React.ReactNode
  defaultOpen?: boolean
}

interface Props {
  items: AccordionItem[]
  allowMultiple?: boolean
}

export function Accordion({ items, allowMultiple = false }: Props) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const item of items) {
      if (item.defaultOpen) initial.add(item.id)
    }
    return initial
  })

  function toggle(id: string) {
    setOpenIds(prev => {
      const next = new Set(allowMultiple ? prev : [])
      if (prev.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className={styles.Root}>
      {items.map(item => {
        const isOpen = openIds.has(item.id)
        return (
          <div key={item.id} className={`${styles.Item} ${isOpen ? styles.Open : ''}`}>
            <button
              className={styles.Trigger}
              onClick={() => toggle(item.id)}
              aria-expanded={isOpen}
              type="button"
            >
              <span className={styles.Title}>{item.title}</span>
              <svg
                className={styles.Arrow}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {isOpen && (
              <div className={styles.Content}>
                {item.content}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
