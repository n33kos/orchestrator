import { useState, useEffect, useRef, useMemo } from 'react'
import styles from './GlobalSearch.module.scss'
import type { WorkItem, SessionInfo } from '../../types.ts'

interface Props {
  items: WorkItem[]
  sessions: SessionInfo[]
  onClose: () => void
  onNavigateToItem: (id: string) => void
  onNavigateToSession: (sessionId: string) => void
}

interface SearchResult {
  id: string
  type: 'item' | 'session'
  title: string
  subtitle: string
  meta?: string
}

export function GlobalSearch({ items, sessions, onClose, onNavigateToItem, onNavigateToSession }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim()
    if (!q) return []

    const itemResults: SearchResult[] = items
      .filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.branch.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q),
      )
      .slice(0, 10)
      .map(i => ({
        id: i.id,
        type: 'item' as const,
        title: i.title,
        subtitle: `${i.type} - ${i.status}`,
        meta: i.branch || undefined,
      }))

    const sessionResults: SearchResult[] = sessions
      .filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map(s => ({
        id: s.id,
        type: 'session' as const,
        title: s.id.slice(0, 12),
        subtitle: s.state,
        meta: s.cwd,
      }))

    return [...itemResults, ...sessionResults]
  }, [query, items, sessions])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      const result = results[selectedIndex]
      if (result.type === 'item') {
        onNavigateToItem(result.id)
      } else {
        onNavigateToSession(result.id)
      }
      onClose()
    }
  }

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div className={styles.Modal} onClick={e => e.stopPropagation()}>
        <div className={styles.InputWrapper}>
          <svg className={styles.SearchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className={styles.Input}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search items, sessions..."
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={styles.Kbd}>esc</kbd>
        </div>
        {results.length > 0 && (
          <div className={styles.Results}>
            {results.map((result, i) => (
              <button
                key={`${result.type}-${result.id}`}
                className={`${styles.Result} ${i === selectedIndex ? styles.ResultActive : ''}`}
                onClick={() => {
                  if (result.type === 'item') onNavigateToItem(result.id)
                  else onNavigateToSession(result.id)
                  onClose()
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                type="button"
              >
                <span className={styles.ResultType}>
                  {result.type === 'item' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  )}
                </span>
                <div className={styles.ResultInfo}>
                  <span className={styles.ResultTitle}>{result.title}</span>
                  <span className={styles.ResultSubtitle}>{result.subtitle}</span>
                </div>
                {result.meta && <span className={styles.ResultMeta}>{result.meta}</span>}
              </button>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className={styles.Empty}>No results found</div>
        )}
      </div>
    </div>
  )
}
