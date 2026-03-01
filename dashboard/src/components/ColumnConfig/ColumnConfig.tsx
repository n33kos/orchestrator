import { useState } from 'react'
import styles from './ColumnConfig.module.scss'

export interface ColumnDef {
  key: string
  label: string
  visible: boolean
  width?: number
}

interface Props {
  columns: ColumnDef[]
  onChange: (columns: ColumnDef[]) => void
  onClose: () => void
}

export function ColumnConfig({ columns, onChange, onClose }: Props) {
  const [draft, setDraft] = useState<ColumnDef[]>(columns)

  function toggleColumn(key: string) {
    setDraft(prev =>
      prev.map(c => c.key === key ? { ...c, visible: !c.visible } : c),
    )
  }

  function moveUp(index: number) {
    if (index === 0) return
    const next = [...draft]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    setDraft(next)
  }

  function moveDown(index: number) {
    if (index >= draft.length - 1) return
    const next = [...draft]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    setDraft(next)
  }

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <h4 className={styles.Title}>Configure Columns</h4>
        <button className={styles.Close} onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className={styles.List}>
        {draft.map((col, i) => (
          <div key={col.key} className={styles.Item}>
            <label className={styles.Label}>
              <input
                type="checkbox"
                checked={col.visible}
                onChange={() => toggleColumn(col.key)}
              />
              {col.label}
            </label>
            <div className={styles.Arrows}>
              <button
                className={styles.Arrow}
                onClick={() => moveUp(i)}
                disabled={i === 0}
                aria-label="Move up"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                className={styles.Arrow}
                onClick={() => moveDown(i)}
                disabled={i === draft.length - 1}
                aria-label="Move down"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.Footer}>
        <button className={styles.ApplyButton} onClick={() => { onChange(draft); onClose() }}>
          Apply
        </button>
      </div>
    </div>
  )
}
