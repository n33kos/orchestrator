import { useState } from 'react'
import styles from './TagList.module.scss'

interface Props {
  tags: string[]
  editable?: boolean
  onAdd?: (tag: string) => void
  onRemove?: (tag: string) => void
  max?: number
}

const TAG_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  '#e879f9',
  '#22d3ee',
  '#fb923c',
]

function getTagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

export function TagList({ tags, editable, onAdd, onRemove, max = 5 }: Props) {
  const [adding, setAdding] = useState(false)
  const [newTag, setNewTag] = useState('')

  function handleSubmit() {
    const trimmed = newTag.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      onAdd?.(trimmed)
    }
    setNewTag('')
    setAdding(false)
  }

  const displayTags = tags.slice(0, max)
  const overflow = tags.length - max

  return (
    <div className={styles.Root}>
      {displayTags.map(tag => (
        <span
          key={tag}
          className={styles.Tag}
          style={{ '--tag-color': getTagColor(tag) } as React.CSSProperties}
        >
          <span className={styles.TagText}>{tag}</span>
          {editable && onRemove && (
            <button
              className={styles.RemoveTag}
              onClick={e => { e.stopPropagation(); onRemove(tag) }}
            >
              &times;
            </button>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span className={styles.Overflow}>+{overflow}</span>
      )}
      {editable && onAdd && !adding && (
        <button className={styles.AddTag} onClick={() => setAdding(true)}>
          +
        </button>
      )}
      {adding && (
        <input
          className={styles.TagInput}
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') { setNewTag(''); setAdding(false) }
          }}
          placeholder="Tag..."
          autoFocus
        />
      )}
    </div>
  )
}
