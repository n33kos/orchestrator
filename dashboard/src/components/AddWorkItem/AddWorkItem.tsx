import { useState } from 'react'
import styles from './AddWorkItem.module.scss'

interface AddWorkItemProps {
  onAdd: (item: NewWorkItem) => void
  onCancel: () => void
}

export interface NewWorkItem {
  title: string
  description: string
  type: string
  priority: number
  branch: string
  prType?: 'graphite_stack'
  repoPath?: string
}

export function AddWorkItem({ onAdd, onCancel }: AddWorkItemProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(1)
  const [branch, setBranch] = useState('')
  const [isGraphiteStack, setIsGraphiteStack] = useState(false)
  const [repoPath, setRepoPath] = useState('')

  const canSubmit = title.trim().length > 0

  function generateBranch() {
    const slug = title.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50)
    setBranch(`feat/${slug}`)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onAdd({
      title: title.trim(),
      description: description.trim(),
      type: 'work_item',
      priority,
      branch: branch.trim(),
      ...(isGraphiteStack ? { prType: 'graphite_stack' } : {}),
      ...(repoPath.trim() ? { repoPath: repoPath.trim() } : {}),
    })
  }

  return (
    <form className={styles.Root} onSubmit={handleSubmit} onClick={e => e.stopPropagation()}>
      <h3 className={styles.FormTitle}>Add Work Item</h3>

      <div className={styles.Field}>
        <label className={styles.Label}>Title</label>
        <input
          className={styles.Input}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g., Enzyme Migration - Consumer Registry"
          autoFocus
        />
      </div>

      <div className={styles.Field}>
        <label className={styles.Label}>Description</label>
        <textarea
          className={styles.Textarea}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What needs to be done?"
          rows={3}
        />
      </div>

      <div className={styles.Field}>
        <label className={styles.Label}>Priority</label>
        <input
          className={styles.Input}
          type="number"
          min={1}
          max={99}
          value={priority}
          onChange={e => setPriority(Number(e.target.value))}
        />
      </div>

      <div className={styles.Field}>
        <label className={styles.Label}>Branch (optional)</label>
        <div className={styles.BranchRow}>
          <input
            className={styles.Input}
            type="text"
            value={branch}
            onChange={e => setBranch(e.target.value)}
            placeholder="e.g., me/project/feature/1/description"
          />
          {title.trim() && !branch && (
            <button type="button" className={styles.GenerateButton} onClick={generateBranch}>
              Generate
            </button>
          )}
        </div>
      </div>

      <div className={styles.Field}>
        <label className={styles.Label}>Repository path (optional — leave empty for default repo)</label>
        <input
          className={styles.Input}
          type="text"
          value={repoPath}
          onChange={e => setRepoPath(e.target.value)}
          placeholder="e.g., ~/my-other-project"
        />
      </div>

      <label className={styles.CheckboxField}>
        <input
          type="checkbox"
          checked={isGraphiteStack}
          onChange={e => setIsGraphiteStack(e.target.checked)}
        />
        <span>Graphite stack (multiple stacked PRs)</span>
      </label>

      <div className={styles.Actions}>
        <button type="button" className={styles.CancelButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.SubmitButton} disabled={!canSubmit}>
          Add to Queue
        </button>
      </div>
    </form>
  )
}
