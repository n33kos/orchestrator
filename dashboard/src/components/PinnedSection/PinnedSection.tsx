import styles from './PinnedSection.module.scss'
import type { WorkItem } from '../../types.ts'

interface Props {
  items: WorkItem[]
  pinnedIds: Set<string>
  onTogglePin: (id: string) => void
  onNavigate: (id: string) => void
}

export function PinnedSection({ items, pinnedIds, onTogglePin, onNavigate }: Props) {
  const pinned = items.filter(i => pinnedIds.has(i.id))

  if (pinned.length === 0) return null

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
        </svg>
        <span className={styles.Title}>Pinned ({pinned.length})</span>
      </div>
      <div className={styles.List}>
        {pinned.map(item => (
          <button
            key={item.id}
            className={styles.Item}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <span className={`${styles.StatusDot} ${styles[`status_${item.status}`]}`} />
            <span className={styles.ItemTitle}>{item.title}</span>
            <button
              className={styles.UnpinButton}
              onClick={e => { e.stopPropagation(); onTogglePin(item.id) }}
              type="button"
              aria-label="Unpin"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </button>
        ))}
      </div>
    </div>
  )
}
