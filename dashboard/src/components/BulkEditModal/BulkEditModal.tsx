import { useState } from 'react'
import styles from './BulkEditModal.module.scss'
import type { WorkItemStatus } from '../../types.ts'

interface Props {
  selectedCount: number
  onApply: (updates: BulkUpdate) => void
  onClose: () => void
}

export interface BulkUpdate {
  status?: WorkItemStatus
  priority?: number
  type?: 'project' | 'quick_fix'
}

export function BulkEditModal({ selectedCount, onApply, onClose }: Props) {
  const [status, setStatus] = useState<WorkItemStatus | ''>('')
  const [priority, setPriority] = useState('')
  const [type, setType] = useState<'project' | 'quick_fix' | ''>('')

  function handleApply() {
    const updates: BulkUpdate = {}
    if (status) updates.status = status
    if (priority) updates.priority = Number(priority)
    if (type) updates.type = type
    onApply(updates)
  }

  const hasChanges = status !== '' || priority !== '' || type !== ''

  return (
    <div className={styles.Overlay}>
      <div className={styles.Modal}>
        <div className={styles.Header}>
          <h3 className={styles.Title}>Edit {selectedCount} item{selectedCount !== 1 ? 's' : ''}</h3>
          <button className={styles.Close} onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.Content}>
          <p className={styles.Hint}>Only fields you set will be updated. Leave blank to skip.</p>
          <label className={styles.Field}>
            <span className={styles.FieldLabel}>Status</span>
            <select
              className={styles.Select}
              value={status}
              onChange={e => setStatus(e.target.value as WorkItemStatus | '')}
            >
              <option value="">-- No change --</option>
              <option value="queued">Queued</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="review">Review</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label className={styles.Field}>
            <span className={styles.FieldLabel}>Priority</span>
            <input
              className={styles.Input}
              type="number"
              min="1"
              max="100"
              value={priority}
              onChange={e => setPriority(e.target.value)}
              placeholder="No change"
            />
          </label>
          <label className={styles.Field}>
            <span className={styles.FieldLabel}>Type</span>
            <select
              className={styles.Select}
              value={type}
              onChange={e => setType(e.target.value as 'project' | 'quick_fix' | '')}
            >
              <option value="">-- No change --</option>
              <option value="project">Project</option>
              <option value="quick_fix">Quick Fix</option>
            </select>
          </label>
        </div>
        <div className={styles.Footer}>
          <button className={styles.CancelButton} onClick={onClose}>Cancel</button>
          <button className={styles.ApplyButton} onClick={handleApply} disabled={!hasChanges}>
            Apply to {selectedCount} item{selectedCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
