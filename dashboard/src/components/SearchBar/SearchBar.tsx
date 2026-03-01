import { forwardRef, useState } from 'react'
import styles from './SearchBar.module.scss'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  resultCount?: number
  searchHistory?: string[]
  onSearchSelect?: (query: string) => void
  onClearHistory?: () => void
  onRemoveHistoryItem?: (query: string) => void
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ value, onChange, placeholder = 'Filter work items...', resultCount, searchHistory, onSearchSelect, onClearHistory, onRemoveHistoryItem }, ref) {
    const [focused, setFocused] = useState(false)
    const showHistory = focused && !value && searchHistory && searchHistory.length > 0

    return (
      <div className={styles.Root}>
        <span className={styles.Icon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={ref}
          className={styles.Input}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder}
        />
        {value && resultCount != null && (
          <span className={styles.ResultCount}>{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
        )}
        {value && (
          <button className={styles.Clear} onClick={() => onChange('')} title="Clear filter">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        {showHistory && (
          <div className={styles.Dropdown}>
            <div className={styles.DropdownHeader}>
              <span className={styles.DropdownTitle}>Recent searches</span>
              {onClearHistory && (
                <button className={styles.DropdownClearAll} onClick={onClearHistory}>Clear all</button>
              )}
            </div>
            {searchHistory.map(query => (
              <div key={query} className={styles.DropdownItem}>
                <button
                  className={styles.DropdownItemButton}
                  onMouseDown={e => {
                    e.preventDefault()
                    onSearchSelect?.(query)
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                  </svg>
                  {query}
                </button>
                {onRemoveHistoryItem && (
                  <button
                    className={styles.DropdownItemRemove}
                    onMouseDown={e => {
                      e.preventDefault()
                      onRemoveHistoryItem(query)
                    }}
                    title="Remove"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
)
