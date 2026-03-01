import { useState, useEffect, useRef } from 'react'
import styles from './DetailPanel.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import { PriorityBadge } from '../PriorityBadge/PriorityBadge.tsx'
import { timeAgo, formatDate } from '../../utils/time.ts'
import type { WorkItem, WorkItemStatus } from '../../types.ts'

interface DetailPanelProps {
  item: WorkItem
  onClose: () => void
  onStatusChange: (id: string, status: WorkItemStatus) => void
  onDelete: (id: string) => void
  onDuplicate?: (id: string) => void
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

export function DetailPanel({ item, onClose, onStatusChange, onDelete, onDuplicate }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const nextAction = getNextAction(item.status)
  const unresolvedBlockers = item.blockers.filter(b => !b.resolved)
  const resolvedBlockers = item.blockers.filter(b => b.resolved)

  return (
    <>
      <div className={styles.Overlay} onClick={onClose} />
      <div className={styles.Panel} ref={panelRef}>
        <div className={styles.Header}>
          <div className={styles.HeaderLeft}>
            <h2 className={styles.Title}>{item.title}</h2>
            <span className={styles.Id}>{item.id}</span>
          </div>
          <button className={styles.CloseButton} onClick={onClose}>
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
              <span className={styles.MetaValue}>{item.delegator_enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>

          <div className={styles.Section}>
            <span className={styles.SectionLabel}>Description</span>
            {item.description ? (
              <p className={styles.Description}>{item.description}</p>
            ) : (
              <span className={styles.EmptyDescription}>No description</span>
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
          {nextAction && (
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
