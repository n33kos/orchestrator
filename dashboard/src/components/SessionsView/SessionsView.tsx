import { useState } from 'react'
import classnames from 'classnames'
import styles from './SessionsView.module.scss'
import type { SessionInfo, WorkItem, MessageEntry } from '../../types.ts'

interface SessionsViewProps {
  sessions: SessionInfo[]
  items: WorkItem[]
  messagesBySession: Record<string, MessageEntry[]>
  onSendMessage: (sessionId: string, text: string) => void
  onKillSession: (sessionId: string) => void
  onReconnectSession: (sessionId: string) => void
  onRefreshSessions: () => void
}

function getSessionName(session: SessionInfo): string {
  const parts = session.cwd.split('/')
  return parts[parts.length - 1] || session.cwd
}

type SessionRole = 'worker' | 'delegator' | 'unlinked'

function findLinkedItems(session: SessionInfo, items: WorkItem[]): WorkItem[] {
  return items.filter(item => {
    if (item.environment?.session_id === session.id) return true
    if (item.environment?.worktree_path && (session.cwd === item.environment.worktree_path || item.environment.worktree_path.startsWith(session.cwd))) return true
    return false
  })
}

function getSessionRole(session: SessionInfo, items: WorkItem[]): SessionRole {
  for (const item of items) {
    if (item.environment?.session_id === session.id) return 'worker'
  }
  return 'unlinked'
}

const stateLabels: Record<string, string> = {
  standby: 'Ready',
  thinking: 'Thinking',
  responding: 'Responding',
  zombie: 'Disconnected',
  unknown: 'Unknown',
}

export function SessionsView({ sessions, items, messagesBySession, onSendMessage, onKillSession, onReconnectSession, onRefreshSessions }: SessionsViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messageText, setMessageText] = useState<Record<string, string>>({})
  const [confirmKill, setConfirmKill] = useState<string | null>(null)
  const [broadcastText, setBroadcastText] = useState('')
  const [showBroadcast, setShowBroadcast] = useState(false)

  function handleSend(sessionId: string) {
    const text = messageText[sessionId]?.trim()
    if (!text) return
    onSendMessage(sessionId, text)
    setMessageText(prev => ({ ...prev, [sessionId]: '' }))
  }

  function handleBroadcast() {
    const text = broadcastText.trim()
    if (!text) return
    const standbyAndActive = sessions.filter(s => s.state === 'standby' || s.state === 'thinking' || s.state === 'responding')
    for (const s of standbyAndActive) {
      onSendMessage(s.id, text)
    }
    setBroadcastText('')
    setShowBroadcast(false)
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.Empty}>
        <div className={styles.EmptyIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <p className={styles.EmptyTitle}>No active sessions</p>
        <p className={styles.EmptyDesc}>
          Sessions appear when vmux workers are running. Use the orchestrator to spin up new environments, or run <code>vmux spawn</code> directly.
        </p>
        <div className={styles.EmptyHints}>
          <div className={styles.EmptyHint}>
            <code>vmux spawn ~/path/to/worktree</code>
            <span>Start a new worker session</span>
          </div>
          <div className={styles.EmptyHint}>
            <code>vmux sessions</code>
            <span>List all sessions from the CLI</span>
          </div>
        </div>
      </div>
    )
  }

  const standby = sessions.filter(s => s.state === 'standby')
  const active = sessions.filter(s => s.state === 'thinking' || s.state === 'responding')
  const zombie = sessions.filter(s => s.state === 'zombie')
  const other = sessions.filter(s => !['standby', 'thinking', 'responding', 'zombie'].includes(s.state))

  const groups = [
    { label: 'Active', sessions: active },
    { label: 'Standby', sessions: standby },
    { label: 'Zombie', sessions: zombie },
    { label: 'Other', sessions: other },
  ].filter(g => g.sessions.length > 0)

  return (
    <div className={styles.Root}>
      <div className={styles.Summary}>
        <div className={styles.SummaryItem}>
          <span className={classnames(styles.SummaryDot, styles.dotActive)} />
          <span className={styles.SummaryCount}>{active.length}</span>
          <span className={styles.SummaryLabel}>active</span>
        </div>
        <div className={styles.SummaryItem}>
          <span className={classnames(styles.SummaryDot, styles.dotStandby)} />
          <span className={styles.SummaryCount}>{standby.length}</span>
          <span className={styles.SummaryLabel}>standby</span>
        </div>
        {zombie.length > 0 && (
          <>
            <div className={styles.SummaryItem}>
              <span className={classnames(styles.SummaryDot, styles.dotZombie)} />
              <span className={styles.SummaryCount}>{zombie.length}</span>
              <span className={styles.SummaryLabel}>zombie</span>
            </div>
            <button
              className={styles.ReconnectAllButton}
              onClick={() => zombie.forEach(s => onReconnectSession(s.id))}
              title="Reconnect all zombie sessions"
            >
              Reconnect all
            </button>
          </>
        )}
        <span className={styles.SummaryTotal}>{sessions.length} total</span>
        <button className={styles.RefreshButton} onClick={onRefreshSessions} title="Refresh sessions">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
        <button
          className={classnames(styles.BroadcastToggle, showBroadcast && styles.BroadcastToggleActive)}
          onClick={() => setShowBroadcast(!showBroadcast)}
          title="Broadcast message to all sessions"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      </div>

      {showBroadcast && (
        <div className={styles.BroadcastBar}>
          <span className={styles.BroadcastLabel}>Broadcast to all active sessions:</span>
          <div className={styles.BroadcastRow}>
            <input
              className={styles.BroadcastInput}
              type="text"
              value={broadcastText}
              onChange={e => setBroadcastText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleBroadcast() }}
              placeholder="Type a message to send to all sessions..."
              autoFocus
            />
            <button
              className={styles.BroadcastSend}
              onClick={handleBroadcast}
              disabled={!broadcastText.trim()}
            >
              Send to {sessions.filter(s => s.state !== 'zombie').length}
            </button>
          </div>
        </div>
      )}

      {groups.map(group => (
        <div key={group.label} className={styles.Group}>
          <h3 className={styles.GroupLabel}>{group.label}</h3>
          {group.sessions.map(session => {
            const name = getSessionName(session)
            const linked = findLinkedItems(session, items)
            const role = getSessionRole(session, items)
            const isExpanded = expandedId === session.id
            const msgs = messagesBySession[session.id] ?? []

            return (
              <div
                key={session.id}
                className={classnames(styles.Card, isExpanded && styles.CardExpanded)}
              >
                <button
                  className={styles.CardHeader}
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                >
                  <span className={classnames(styles.StateDot, styles[session.state])} />
                  <div className={styles.CardInfo}>
                    <span className={styles.CardName}>{name}</span>
                    <span className={styles.CardState}>{stateLabels[session.state] || session.state}</span>
                  </div>
                  {role !== 'unlinked' && (
                    <span className={classnames(styles.RoleBadge, styles[`role_${role}`])}>
                      {role === 'delegator' ? 'Delegator' : 'Worker'}
                    </span>
                  )}
                  {linked.length > 0 && (
                    <span className={styles.LinkedBadge} title={`${linked.length} linked work item${linked.length > 1 ? 's' : ''}`}>
                      {linked.length} item{linked.length > 1 ? 's' : ''}
                    </span>
                  )}
                  <svg
                    className={classnames(styles.Chevron, isExpanded && styles.ChevronOpen)}
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className={styles.CardBody}>
                    <div className={styles.MetaGrid}>
                      <div className={styles.MetaItem}>
                        <span className={styles.MetaLabel}>Session ID</span>
                        <code className={styles.MetaValue}>{session.id}</code>
                      </div>
                      <div className={styles.MetaItem}>
                        <span className={styles.MetaLabel}>State</span>
                        <span className={classnames(styles.MetaValue, styles.MetaState)}>
                          <span className={classnames(styles.MiniDot, styles[session.state])} />
                          {stateLabels[session.state] || session.state}
                        </span>
                      </div>
                      <div className={classnames(styles.MetaItem, styles.MetaWide)}>
                        <span className={styles.MetaLabel}>Working Directory</span>
                        <code className={styles.MetaValue}>{session.cwd}</code>
                      </div>
                      <div className={classnames(styles.MetaItem, styles.MetaWide)}>
                        <span className={styles.MetaLabel}>tmux Session</span>
                        <code className={styles.MetaValue}>{session.tmux}</code>
                      </div>
                    </div>

                    {linked.length > 0 && (
                      <div className={styles.LinkedSection}>
                        <h4 className={styles.SectionLabel}>Linked Work Items</h4>
                        <div className={styles.LinkedList}>
                          {linked.map(item => (
                            <div key={item.id} className={styles.LinkedItem}>
                              <span className={classnames(styles.LinkedDot, styles[`linked_${item.status}`])} />
                              <span className={styles.LinkedTitle}>{item.title}</span>
                              <span className={styles.LinkedStatus}>{item.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {msgs.length > 0 && (
                      <div className={styles.MessagesSection}>
                        <h4 className={styles.SectionLabel}>Messages</h4>
                        <div className={styles.Messages}>
                          {msgs.slice(-5).map(msg => (
                            <div key={msg.id} className={classnames(styles.Msg, styles[msg.direction])}>
                              <span>{msg.text}</span>
                              <span className={styles.MsgTime}>
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={styles.SendRow}>
                      <input
                        className={styles.SendInput}
                        type="text"
                        value={messageText[session.id] ?? ''}
                        onChange={e => setMessageText(prev => ({ ...prev, [session.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(session.id) }}
                        placeholder={`Message ${name}...`}
                      />
                      <button
                        className={styles.SendButton}
                        onClick={() => handleSend(session.id)}
                        disabled={!(messageText[session.id]?.trim())}
                        title="Send message"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </button>
                    </div>

                    <div className={styles.ActionRow}>
                      {session.state === 'zombie' && (
                        <button
                          className={styles.ReconnectButton}
                          onClick={() => onReconnectSession(session.id)}
                          title="Reconnect session"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                          </svg>
                          Reconnect
                        </button>
                      )}
                      {confirmKill === session.id ? (
                        <div className={styles.ConfirmKill}>
                          <span className={styles.ConfirmText}>Kill this session?</span>
                          <button
                            className={styles.ConfirmYes}
                            onClick={() => { onKillSession(session.id); setConfirmKill(null) }}
                          >
                            Yes, kill
                          </button>
                          <button
                            className={styles.ConfirmNo}
                            onClick={() => setConfirmKill(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className={styles.KillButton}
                          onClick={() => setConfirmKill(session.id)}
                          title="Kill session"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                          </svg>
                          Kill Session
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
