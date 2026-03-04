import { useState, useEffect, useRef } from 'react'
import styles from './DetailPanel.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'
import { ItemDetails } from '../ItemDetails/ItemDetails.tsx'
import type { WorkItem, WorkItemStatus, SessionInfo } from '../../types.ts'
import type { DelegatorStatus } from '../../hooks/useDelegators.ts'

interface DetailPanelProps {
  item: WorkItem
  allItems?: WorkItem[]
  sessions?: SessionInfo[]
  delegator?: DelegatorStatus
  onClose: () => void
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onUpdate?: (id: string, fields: Partial<Pick<WorkItem, 'title' | 'description'>>) => void
  onDelete: (id: string) => void
  onDuplicate?: (id: string) => void
  onNotesChange?: (id: string, notes: string) => void
  onActivateStream?: (id: string) => void
  onTeardownStream?: (id: string) => void
  onSendMessage?: (sessionId: string, text: string) => void
  onDelegatorToggle?: (id: string, enabled: boolean) => void
  onGeneratePlan?: (id: string) => void
  onRefresh?: () => void
  onUpdateBlockedBy?: (id: string, blocked_by: string[]) => void
}

export function DetailPanel({ item, allItems = [], sessions, delegator, onClose, onStatusChange, onUpdate, onDelete, onDuplicate, onNotesChange, onActivateStream, onTeardownStream, onSendMessage, onDelegatorToggle, onGeneratePlan, onRefresh, onUpdateBlockedBy }: DetailPanelProps) {
  const panelRef = useFocusTrap<HTMLDivElement>()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleText, setTitleText] = useState(item.title)
  const titleRef = useRef<HTMLInputElement>(null)

  // Sync title when item changes
  useEffect(() => { if (!editingTitle) setTitleText(item.title) }, [item.title, editingTitle])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editingTitle) { setTitleText(item.title); setEditingTitle(false); return }
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, editingTitle, item.title])

  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus()
      titleRef.current.selectionStart = titleRef.current.value.length
    }
  }, [editingTitle])

  // Find linked session
  const linkedSession = sessions?.find(s =>
    (item.session_id && s.id === item.session_id) ||
    (item.worktree_path && (s.cwd === item.worktree_path || item.worktree_path!.startsWith(s.cwd)))
  )

  return (
    <>
      <div className={styles.Overlay} onClick={onClose} />
      <div className={styles.Panel} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="detail-panel-title">
        <div className={styles.Header}>
          <div className={styles.HeaderLeft}>
            {editingTitle ? (
              <input
                ref={titleRef}
                className={styles.TitleInput}
                value={titleText}
                onChange={e => setTitleText(e.target.value)}
                onBlur={() => {
                  if (titleText.trim() && titleText !== item.title && onUpdate) {
                    onUpdate(item.id, { title: titleText.trim() })
                  }
                  setEditingTitle(false)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setTitleText(item.title); setEditingTitle(false) }
                }}
              />
            ) : (
              <h2
                id="detail-panel-title"
                className={styles.Title}
                onClick={() => { if (onUpdate) setEditingTitle(true) }}
                title={onUpdate ? 'Click to edit title' : undefined}
                style={onUpdate ? { cursor: 'text' } : undefined}
              >
                {item.title}
              </h2>
            )}
            <span className={styles.Id}>{item.id}</span>
          </div>
          <button className={styles.CloseButton} onClick={onClose} aria-label="Close detail panel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.Content}>
          <ItemDetails
            item={item}
            variant="panel"
            allItems={allItems}
            sessions={sessions}
            sessionInfo={linkedSession}
            delegator={delegator}
            onStatusChange={onStatusChange}
            onEdit={onUpdate}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onActivateStream={onActivateStream}
            onTeardownStream={onTeardownStream}
            onSendMessage={onSendMessage}
            onDelegatorToggle={onDelegatorToggle}
            onGeneratePlan={onGeneratePlan}
            onNotesChange={onNotesChange}
            onRefresh={onRefresh}
            onUpdateBlockedBy={onUpdateBlockedBy}
          />
        </div>
      </div>
    </>
  )
}
