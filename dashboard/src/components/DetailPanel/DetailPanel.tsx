import { useState, useEffect, useRef } from 'react'
import styles from './DetailPanel.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { ItemNotes } from '../ItemNotes/ItemNotes.tsx'
import { timeAgo, formatDate } from '../../utils/time.ts'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'
import { usePrStack } from '../../hooks/usePrStatus.ts'
import type { StackPr } from '../../hooks/usePrStatus.ts'
import type { WorkItem, WorkItemStatus, SessionInfo } from '../../types.ts'
import type { DelegatorStatus } from '../../hooks/useDelegators.ts'

interface DetailPanelProps {
  item: WorkItem
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
}

function getNextAction(status: WorkItemStatus): { label: string; nextStatus: WorkItemStatus } | null {
  if (status === 'queued' || status === 'planning') return { label: 'Activate', nextStatus: 'active' }
  if (status === 'active') return { label: 'Move to Review', nextStatus: 'review' }
  if (status === 'review') return { label: 'Complete', nextStatus: 'completed' }
  if (status === 'paused') return { label: 'Resume', nextStatus: 'active' }
  return null
}

function formatItemSummary(item: WorkItem): string {
  const lines = [
    `# ${item.title}`,
    `ID: ${item.id}`,
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    `Type: ${item.type}`,
    item.branch ? `Branch: ${item.branch}` : '',
    item.pr_url ? `PR: ${item.pr_url}` : '',
    item.description ? `\nDescription:\n${item.description}` : '',
    item.blockers.length > 0
      ? `\nBlockers:\n${item.blockers.map(b => `- [${b.resolved ? 'x' : ' '}] ${b.description}`).join('\n')}`
      : '',
  ]
  return lines.filter(Boolean).join('\n')
}

export function DetailPanel({ item, sessions, delegator, onClose, onStatusChange, onUpdate, onDelete, onDuplicate, onNotesChange, onActivateStream, onTeardownStream, onSendMessage }: DetailPanelProps) {
  const panelRef = useFocusTrap<HTMLDivElement>()
  const [copied, setCopied] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [titleText, setTitleText] = useState(item.title)
  const [descriptionText, setDescriptionText] = useState(item.description)
  const [notesText, setNotesText] = useState((item.metadata?.notes as string) || '')
  const [prStatus, setPrStatus] = useState<{ state?: string; reviewDecision?: string; checks?: string; url?: string } | null>(null)
  const [messageText, setMessageText] = useState('')
  const isStack = item.metadata?.pr_type === 'graphite_stack'
  const { stack: prStack } = usePrStack(item.pr_url, isStack)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editingNotes) { setEditingNotes(false); return }
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, editingNotes])

  // Fetch PR status if pr_url is set
  useEffect(() => {
    if (!item.pr_url) return
    const url = encodeURIComponent(item.pr_url)
    fetch(`/api/pr-status?url=${url}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setPrStatus(data) })
      .catch(() => {})
  }, [item.pr_url])

  // Focus inputs when entering edit mode
  useEffect(() => {
    if (editingNotes && notesRef.current) {
      notesRef.current.focus()
      notesRef.current.selectionStart = notesRef.current.value.length
    }
  }, [editingNotes])

  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus()
      titleRef.current.selectionStart = titleRef.current.value.length
    }
  }, [editingTitle])

  useEffect(() => {
    if (editingDescription && descRef.current) {
      descRef.current.focus()
      descRef.current.selectionStart = descRef.current.value.length
    }
  }, [editingDescription])

  const linkedSession = sessions?.find(s =>
    (item.session_id && s.id === item.session_id) ||
    (item.worktree_path && (s.cwd === item.worktree_path || item.worktree_path!.startsWith(s.cwd)))
  )

  const plan = item.metadata?.plan as { title?: string; steps?: { text: string; done?: boolean }[]; approved?: boolean } | undefined
  const implNotes = (item.metadata?.implementation_notes as string) || ''

  const nextAction = getNextAction(item.status)
  const unresolvedBlockers = item.blockers.filter(b => !b.resolved)
  const resolvedBlockers = item.blockers.filter(b => b.resolved)

  function saveNotes() {
    if (onNotesChange) {
      onNotesChange(item.id, notesText)
    }
    setEditingNotes(false)
  }

  const stateLabels: Record<string, string> = {
    standby: 'Ready',
    thinking: 'Thinking',
    responding: 'Responding',
    zombie: 'Disconnected',
    unknown: 'Unknown',
  }

  const prStateLabels: Record<string, { label: string; cls: string }> = {
    OPEN: { label: 'Open', cls: 'prOpen' },
    CLOSED: { label: 'Closed', cls: 'prClosed' },
    MERGED: { label: 'Merged', cls: 'prMerged' },
  }

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
          <div className={styles.MetaGrid}>
            <div className={styles.MetaItem}>
              <span className={styles.MetaLabel}>Status</span>
              <StatusBadge status={item.status} />
            </div>
            <div className={styles.MetaItem}>
              <span className={styles.MetaLabel}>Priority</span>
              <PriorityBadge priority={item.priority} size="md" />
            </div>
            <div className={styles.MetaItem}>
              <span className={styles.MetaLabel}>Type</span>
              <span className={styles.MetaValue}>{item.type === 'project' ? 'Project' : 'Quick Fix'}</span>
            </div>
            <div className={styles.MetaItem}>
              <span className={styles.MetaLabel}>Created</span>
              <span className={styles.MetaValue} title={formatDate(item.created_at)}>{timeAgo(item.created_at)}</span>
            </div>
            {item.activated_at && (
              <div className={styles.MetaItem}>
                <span className={styles.MetaLabel}>Activated</span>
                <span className={styles.MetaValue} title={formatDate(item.activated_at)}>{timeAgo(item.activated_at)}</span>
              </div>
            )}
            {item.completed_at && (
              <div className={styles.MetaItem}>
                <span className={styles.MetaLabel}>Completed</span>
                <span className={styles.MetaValue} title={formatDate(item.completed_at)}>{timeAgo(item.completed_at)}</span>
              </div>
            )}
            <div className={styles.MetaItem}>
              <span className={styles.MetaLabel}>Delegator</span>
              <span className={styles.MetaValue}>
                {delegator
                  ? `${delegator.status} (${delegator.commits_reviewed} commits, ${delegator.issues_found.length} issues)`
                  : item.delegator_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>

          <div className={styles.Section}>
            <div className={styles.SectionHeader}>
              <span className={styles.SectionLabel}>Description</span>
              {onUpdate && !editingDescription && (
                <button className={styles.EditNotesButton} onClick={() => setEditingDescription(true)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </button>
              )}
            </div>
            {editingDescription ? (
              <div className={styles.NotesEdit}>
                <textarea
                  ref={descRef}
                  className={styles.NotesTextarea}
                  value={descriptionText}
                  onChange={e => setDescriptionText(e.target.value)}
                  placeholder="Describe this work item..."
                  rows={6}
                />
                <div className={styles.NotesActions}>
                  <button
                    className={styles.NotesSave}
                    onClick={() => {
                      if (onUpdate) onUpdate(item.id, { description: descriptionText })
                      setEditingDescription(false)
                    }}
                  >
                    Save
                  </button>
                  <button
                    className={styles.NotesCancel}
                    onClick={() => { setEditingDescription(false); setDescriptionText(item.description) }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {item.description ? (
                  <p className={styles.Description}>{item.description}</p>
                ) : (
                  <span className={styles.EmptyDescription}>
                    {onUpdate ? 'Click edit to add a description' : 'No description'}
                  </span>
                )}
              </>
            )}
          </div>

          {item.branch && (
            <div className={styles.Section}>
              <span className={styles.SectionLabel}>Branch</span>
              <div className={styles.BranchRow}>
                <code className={styles.BranchCode}>{item.branch}</code>
                <button
                  className={styles.CopyButton}
                  onClick={() => navigator.clipboard.writeText(item.branch)}
                  aria-label="Copy branch name"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy
                </button>
              </div>
            </div>
          )}

          {item.worktree_path && (
            <div className={styles.Section}>
              <span className={styles.SectionLabel}>Worktree Path</span>
              <code className={styles.BranchCode}>{item.worktree_path}</code>
            </div>
          )}

          {/* Linked Session */}
          {linkedSession && (
            <div className={styles.Section}>
              <span className={styles.SectionLabel}>Linked Session</span>
              <div className={styles.SessionCard}>
                <span className={`${styles.SessionDot} ${styles[`session_${linkedSession.state}`]}`} />
                <div className={styles.SessionInfo}>
                  <span className={styles.SessionState}>{stateLabels[linkedSession.state] || linkedSession.state}</span>
                  <code className={styles.SessionId}>{linkedSession.id.slice(0, 12)}</code>
                </div>
                <code className={styles.SessionCwd}>{linkedSession.cwd.split('/').pop()}</code>
              </div>
              {onSendMessage && linkedSession.state !== 'zombie' && (
                <form
                  className={styles.SessionMessageForm}
                  onSubmit={e => {
                    e.preventDefault()
                    if (messageText.trim()) {
                      onSendMessage(linkedSession.id, messageText.trim())
                      setMessageText('')
                    }
                  }}
                >
                  <input
                    className={styles.SessionMessageInput}
                    type="text"
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    placeholder="Send message to worker..."
                    aria-label="Message to worker session"
                  />
                  <button
                    type="submit"
                    className={styles.SessionMessageSend}
                    disabled={!messageText.trim()}
                    aria-label="Send message"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </form>
              )}
            </div>
          )}

          {/* PR Status */}
          {item.pr_url && (
            <div className={styles.Section}>
              <span className={styles.SectionLabel}>
                {isStack ? 'PR Stack (Graphite)' : 'Pull Request'}
              </span>
              {isStack && prStack ? (
                <div className={styles.PrCard}>
                  {prStack.graphiteStackUrl && (
                    <a href={prStack.graphiteStackUrl} target="_blank" rel="noopener noreferrer" className={styles.PrLink}>
                      View full stack on Graphite
                    </a>
                  )}
                  {prStack.prs.map((pr: StackPr) => (
                    <div key={pr.number} className={styles.StackItem}>
                      <a href={pr.url} target="_blank" rel="noopener noreferrer" className={styles.PrLink}>
                        #{pr.number}
                      </a>
                      <span className={styles.StackPrTitle}>{pr.title}</span>
                      <span className={`${styles.PrBadge} ${styles[`pr_${pr.state.toLowerCase()}`] || ''}`}>
                        {pr.state}
                      </span>
                      {pr.checksPass && <span className={`${styles.PrBadge} ${styles.pr_pass}`}>Pass</span>}
                      {pr.checksFail && <span className={`${styles.PrBadge} ${styles.pr_fail}`}>Fail</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.PrCard}>
                  <a href={item.pr_url} target="_blank" rel="noopener noreferrer" className={styles.PrLink}>
                    {item.pr_url.replace(/^https:\/\/github\.com\//, '')}
                  </a>
                  {prStatus && (
                    <div className={styles.PrMeta}>
                      {prStatus.state && (
                        <span className={`${styles.PrBadge} ${styles[prStateLabels[prStatus.state]?.cls || '']}`}>
                          {prStateLabels[prStatus.state]?.label || prStatus.state}
                        </span>
                      )}
                      {prStatus.reviewDecision && (
                        <span className={styles.PrReview}>
                          {prStatus.reviewDecision === 'APPROVED' ? 'Approved' :
                           prStatus.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' :
                           prStatus.reviewDecision === 'REVIEW_REQUIRED' ? 'Review needed' :
                           prStatus.reviewDecision}
                        </span>
                      )}
                      {prStatus.checks && (
                        <span className={styles.PrChecks}>
                          {prStatus.checks === 'SUCCESS' ? 'Checks passing' :
                           prStatus.checks === 'FAILURE' ? 'Checks failing' :
                           prStatus.checks === 'PENDING' ? 'Checks running' :
                           prStatus.checks}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Plan Overview */}
          {plan && (
            <div className={styles.Section}>
              <span className={styles.SectionLabel}>
                Plan {plan.approved ? '(Approved)' : '(Draft)'}
              </span>
              <div className={styles.PlanCard}>
                {plan.title && <div className={styles.PlanTitle}>{plan.title}</div>}
                {plan.steps && plan.steps.length > 0 && (
                  <div className={styles.PlanSteps}>
                    {plan.steps.map((step, i) => (
                      <div key={i} className={styles.PlanStep}>
                        <span className={`${styles.PlanCheck} ${step.done ? styles.PlanCheckDone : ''}`}>
                          {step.done ? '\u2713' : (i + 1)}
                        </span>
                        <span className={step.done ? styles.PlanStepDone : ''}>{step.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className={styles.Section}>
            <div className={styles.SectionHeader}>
              <span className={styles.SectionLabel}>Notes</span>
              {onNotesChange && !editingNotes && (
                <button className={styles.EditNotesButton} onClick={() => setEditingNotes(true)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className={styles.NotesEdit}>
                <textarea
                  ref={notesRef}
                  className={styles.NotesTextarea}
                  value={notesText}
                  onChange={e => setNotesText(e.target.value)}
                  placeholder="Add notes about this work item..."
                  rows={4}
                />
                <div className={styles.NotesActions}>
                  <button className={styles.NotesSave} onClick={saveNotes}>Save</button>
                  <button className={styles.NotesCancel} onClick={() => { setEditingNotes(false); setNotesText((item.metadata?.notes as string) || '') }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {notesText ? (
                  <p className={styles.Description}>{notesText}</p>
                ) : (
                  <span className={styles.EmptyDescription}>
                    {onNotesChange ? 'Click edit to add notes' : 'No notes'}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Implementation Notes (read-only, from metadata) */}
          {implNotes && (
            <div className={styles.Section}>
              <span className={styles.SectionLabel}>Implementation Notes</span>
              <p className={styles.Description}>{implNotes}</p>
            </div>
          )}

          <div className={styles.Section}>
            <ItemNotes itemId={item.id} />
          </div>

          <div className={styles.Section}>
            <span className={styles.SectionLabel}>
              Blockers ({unresolvedBlockers.length} open, {resolvedBlockers.length} resolved)
            </span>
            {item.blockers.length === 0 ? (
              <span className={styles.NoBlockers}>No blockers</span>
            ) : (
              <div className={styles.BlockerList}>
                {unresolvedBlockers.map(b => (
                  <div key={b.id} className={styles.Blocker}>
                    <span className={styles.BlockerDot} />
                    <span className={styles.BlockerText}>{b.description}</span>
                  </div>
                ))}
                {resolvedBlockers.map(b => (
                  <div key={b.id} className={styles.Blocker}>
                    <span className={`${styles.BlockerDot} ${styles.BlockerResolved}`} />
                    <span className={styles.BlockerText}>{b.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.Footer}>
          {item.status === 'queued' && onActivateStream && (
            <button
              className={`${styles.FooterButton} ${styles.FooterPrimary}`}
              onClick={() => onActivateStream(item.id)}
            >
              Activate Stream
            </button>
          )}
          {item.status === 'active' && onTeardownStream && (
            <button
              className={`${styles.FooterButton} ${styles.FooterDanger}`}
              onClick={() => onTeardownStream(item.id)}
            >
              Tear Down
            </button>
          )}
          {nextAction && !(item.status === 'queued' && onActivateStream) && (
            <button
              className={`${styles.FooterButton} ${styles.FooterPrimary}`}
              onClick={() => onStatusChange(item.id, nextAction.nextStatus)}
            >
              {nextAction.label}
            </button>
          )}
          <button
            className={styles.FooterButton}
            onClick={() => {
              navigator.clipboard.writeText(formatItemSummary(item))
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied!' : 'Copy Summary'}
          </button>
          {onDuplicate && (
            <button className={styles.FooterButton} onClick={() => onDuplicate(item.id)}>
              Duplicate
            </button>
          )}
          <button
            className={`${styles.FooterButton} ${styles.FooterDanger}`}
            onClick={() => onDelete(item.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </>
  )
}
