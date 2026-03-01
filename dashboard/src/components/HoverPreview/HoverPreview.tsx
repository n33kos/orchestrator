import { useState, useRef, useEffect } from 'react'
import styles from './HoverPreview.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo } from '../../utils/time.ts'
import type { WorkItem } from '../../types.ts'

interface Props {
  item: WorkItem
  anchorRect: DOMRect
}

export function HoverPreview({ item, anchorRect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const viewportH = window.innerHeight
    const viewportW = window.innerWidth

    let top = anchorRect.bottom + 4
    let left = anchorRect.left

    // Flip up if overflowing bottom
    if (top + rect.height > viewportH - 16) {
      top = anchorRect.top - rect.height - 4
    }
    // Keep within right edge
    if (left + rect.width > viewportW - 16) {
      left = viewportW - rect.width - 16
    }

    setPosition({ top, left })
  }, [anchorRect])

  const blockers = item.blockers.filter(b => !b.resolved)

  return (
    <div ref={ref} className={styles.Root} style={{ top: position.top, left: position.left }}>
      <div className={styles.Header}>
        <span className={styles.Title}>{item.title}</span>
        <div className={styles.Badges}>
          <StatusBadge status={item.status} />
          <PriorityBadge priority={item.priority} />
        </div>
      </div>
      {item.description && (
        <p className={styles.Description}>{item.description.slice(0, 200)}{item.description.length > 200 ? '...' : ''}</p>
      )}
      <div className={styles.Meta}>
        {item.branch && <code className={styles.Branch}>{item.branch}</code>}
        <span className={styles.Time}>{timeAgo(item.activated_at || item.created_at)}</span>
      </div>
      {blockers.length > 0 && (
        <div className={styles.Blockers}>
          {blockers.length} blocker{blockers.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
