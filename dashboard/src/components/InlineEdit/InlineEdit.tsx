import { useState, useRef, useEffect } from 'react'
import styles from './InlineEdit.module.scss'

interface InlineEditProps {
  value: string
  onSave: (value: string) => void
  className?: string
  multiline?: boolean
}

export function InlineEdit({ value, onSave, className, multiline }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(value)
    setEditing(true)
  }

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') {
      cancel()
    }
  }

  if (!editing) {
    return (
      <span
        className={`${styles.Display} ${className || ''}`}
        onDoubleClick={startEdit}
        title="Double-click to edit"
      >
        {value}
      </span>
    )
  }

  if (multiline) {
    return (
      <div className={styles.EditContainer} onClick={e => e.stopPropagation()}>
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className={styles.TextareaInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          rows={3}
        />
      </div>
    )
  }

  return (
    <div className={styles.EditContainer} onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        className={styles.Input}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={save}
      />
    </div>
  )
}
