import { useState, useCallback } from 'react'
import styles from './ItemNotes.module.scss'

interface Note {
  id: string
  text: string
  timestamp: string
}

interface Props {
  itemId: string
}

function getNotesKey(itemId: string): string {
  return `orchestrator:notes:${itemId}`
}

function loadNotes(itemId: string): Note[] {
  try {
    const raw = localStorage.getItem(getNotesKey(itemId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveNotes(itemId: string, notes: Note[]) {
  try {
    localStorage.setItem(getNotesKey(itemId), JSON.stringify(notes))
  } catch { /* quota exceeded */ }
}

export function ItemNotes({ itemId }: Props) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes(itemId))
  const [draft, setDraft] = useState('')

  const addNote = useCallback(() => {
    const trimmed = draft.trim()
    if (!trimmed) return
    const note: Note = {
      id: `note-${Date.now()}`,
      text: trimmed,
      timestamp: new Date().toISOString(),
    }
    const updated = [note, ...notes]
    setNotes(updated)
    saveNotes(itemId, updated)
    setDraft('')
  }, [draft, notes, itemId])

  const removeNote = useCallback((noteId: string) => {
    const updated = notes.filter(n => n.id !== noteId)
    setNotes(updated)
    saveNotes(itemId, updated)
  }, [notes, itemId])

  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <h4 className={styles.Title}>Notes</h4>
        {notes.length > 0 && <span className={styles.Count}>{notes.length}</span>}
      </div>
      <div className={styles.InputRow}>
        <textarea
          className={styles.Textarea}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              addNote()
            }
          }}
        />
        <button className={styles.AddButton} onClick={addNote} disabled={!draft.trim()} type="button">
          Add
        </button>
      </div>
      {notes.length > 0 && (
        <div className={styles.List}>
          {notes.map(note => (
            <div key={note.id} className={styles.Note}>
              <p className={styles.NoteText}>{note.text}</p>
              <div className={styles.NoteMeta}>
                <span className={styles.NoteTime}>{formatTime(note.timestamp)}</span>
                <button
                  className={styles.RemoveButton}
                  onClick={() => removeNote(note.id)}
                  type="button"
                  aria-label="Remove note"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
