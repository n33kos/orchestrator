import { useState } from 'react'
import classnames from 'classnames'
import styles from './BlockerManager.module.scss'
import type { Blocker } from '../../types.ts'

interface BlockerManagerProps {
  blockers: Blocker[]
  onAddBlocker: (description: string) => void
  onResolveBlocker: (blockerId: string) => void
  onUnresolveBlocker: (blockerId: string) => void
}

export function BlockerManager({ blockers, onAddBlocker, onResolveBlocker, onUnresolveBlocker }: BlockerManagerProps) {
  const [newBlocker, setNewBlocker] = useState('')
  const [showForm, setShowForm] = useState(false)
  const unresolved = blockers.filter(b => !b.resolved)
  const resolved = blockers.filter(b => b.resolved)

  function handleAdd() {
    if (!newBlocker.trim()) return
    onAddBlocker(newBlocker.trim())
    setNewBlocker('')
    setShowForm(false)
  }

  return (
    <div className={styles.Root} onClick={e => e.stopPropagation()}>
      {unresolved.map(b => (
        <div key={b.id} className={styles.Blocker}>
          <button className={styles.BlockerDot} data-resolved="false" onClick={() => onResolveBlocker(b.id)} title="Resolve blocker" />
          <span className={styles.BlockerText}>{b.description}</span>
        </div>
      ))}
      {resolved.map(b => (
        <div key={b.id} className={classnames(styles.Blocker, styles.BlockerResolved)}>
          <button className={styles.BlockerDot} data-resolved="true" onClick={() => onUnresolveBlocker(b.id)} title="Unresolve blocker" />
          <span className={styles.BlockerText}>{b.description}</span>
        </div>
      ))}
      {showForm ? (
        <div className={styles.AddForm}>
          <input
            className={styles.AddInput}
            type="text"
            value={newBlocker}
            onChange={e => setNewBlocker(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Describe the blocker..."
            autoFocus
          />
          <div className={styles.AddActions}>
            <button className={styles.AddCancel} onClick={() => { setShowForm(false); setNewBlocker('') }}>Cancel</button>
            <button className={styles.AddSubmit} onClick={handleAdd} disabled={!newBlocker.trim()}>Add</button>
          </div>
        </div>
      ) : (
        <button className={styles.AddButton} onClick={() => setShowForm(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add blocker
        </button>
      )}
    </div>
  )
}
