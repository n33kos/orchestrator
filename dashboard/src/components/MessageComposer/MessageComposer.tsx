import { useState, useRef, useEffect } from 'react'
import classnames from 'classnames'
import styles from './MessageComposer.module.scss'
import type { MessageEntry } from '../../types.ts'

interface MessageComposerProps {
  sessionId: string
  sessionState: string
  messages: MessageEntry[]
  onSend: (text: string) => void
}

export function MessageComposer({ sessionId, sessionState, messages, onSend }: MessageComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    onSend(trimmed)
    setText('')
    setSending(false)
    inputRef.current?.focus()
  }

  return (
    <div className={styles.Root} onClick={e => e.stopPropagation()}>
      <div className={styles.Header}>
        <div className={classnames(styles.Dot, styles[sessionState])} />
        <span className={styles.Label}>Session {sessionId.slice(0, 8)}</span>
        <span className={styles.State}>{sessionState}</span>
      </div>

      {messages.length > 0 && (
        <div className={styles.Messages} ref={listRef}>
          {messages.map(msg => (
            <div key={msg.id} className={classnames(styles.Message, styles[msg.direction])}>
              <span className={styles.MessageText}>{msg.text}</span>
              <span className={styles.MessageTime}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.InputRow}>
        <input
          ref={inputRef}
          className={styles.Input}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder="Send a message to this session..."
          disabled={sending}
        />
        <button
          className={styles.SendButton}
          onClick={handleSend}
          disabled={!text.trim() || sending}
          title="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
