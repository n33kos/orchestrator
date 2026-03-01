import { useState } from 'react'
import classnames from 'classnames'
import styles from './SessionsPanel.module.scss'
import type { SessionInfo, MessageEntry } from '../../types.ts'

interface SessionsPanelProps {
  sessions: SessionInfo[]
  messagesBySession: Record<string, MessageEntry[]>
  onClose: () => void
  onSendMessage: (sessionId: string, text: string) => void
}

function getSessionName(session: SessionInfo): string {
  const parts = session.cwd.split('/')
  return parts[parts.length - 1] || session.cwd
}

export function SessionsPanel({ sessions, messagesBySession, onClose, onSendMessage }: SessionsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messageText, setMessageText] = useState<Record<string, string>>({})

  function handleSend(sessionId: string) {
    const text = messageText[sessionId]?.trim()
    if (!text) return
    onSendMessage(sessionId, text)
    setMessageText(prev => ({ ...prev, [sessionId]: '' }))
  }

  const standby = sessions.filter(s => s.state === 'standby')
  const active = sessions.filter(s => s.state === 'thinking' || s.state === 'responding')
  const zombie = sessions.filter(s => s.state === 'zombie')
  const other = sessions.filter(s => !['standby', 'thinking', 'responding', 'zombie'].includes(s.state))

  const groups = [
    { label: 'Active', sessions: active, empty: false },
    { label: 'Standby', sessions: standby, empty: false },
    { label: 'Zombie', sessions: zombie, empty: false },
    { label: 'Other', sessions: other, empty: false },
  ].filter(g => g.sessions.length > 0)

  return (
    <>
      <div className={styles.Overlay} onClick={onClose} />
      <div className={styles.Panel}>
        <div className={styles.Header}>
          <div className={styles.HeaderLeft}>
            <h2 className={styles.Title}>Sessions</h2>
            <span className={styles.Count}>{sessions.length}</span>
          </div>
          <button className={styles.CloseButton} onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.Body}>
          {sessions.length === 0 && (
            <div className={styles.Empty}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <p>No active sessions</p>
              <p className={styles.EmptySub}>Sessions will appear when vmux workers are running.</p>
            </div>
          )}

          {groups.map(group => (
            <div key={group.label} className={styles.Group}>
              <h3 className={styles.GroupLabel}>{group.label}</h3>
              {group.sessions.map(session => {
                const name = getSessionName(session)
                const isExpanded = expandedId === session.id
                const msgs = messagesBySession[session.id] ?? []

                return (
                  <div
                    key={session.id}
                    className={classnames(styles.Session, isExpanded && styles.SessionExpanded)}
                  >
                    <button
                      className={styles.SessionHeader}
                      onClick={() => setExpandedId(isExpanded ? null : session.id)}
                    >
                      <span className={classnames(styles.Dot, styles[session.state])} />
                      <span className={styles.SessionName}>{name}</span>
                      <code className={styles.SessionId}>{session.id.slice(0, 8)}</code>
                      <span className={styles.SessionState}>{session.state}</span>
                      <svg
                        className={classnames(styles.Chevron, isExpanded && styles.ChevronOpen)}
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className={styles.SessionBody}>
                        <div className={styles.SessionMeta}>
                          <span className={styles.MetaLabel}>CWD</span>
                          <code className={styles.MetaValue}>{session.cwd}</code>
                        </div>
                        <div className={styles.SessionMeta}>
                          <span className={styles.MetaLabel}>tmux</span>
                          <code className={styles.MetaValue}>{session.tmux}</code>
                        </div>

                        {msgs.length > 0 && (
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
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="22" y1="2" x2="11" y2="13" />
                              <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
