import { forwardRef } from 'react'
import styles from './SearchBar.module.scss'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  resultCount?: number
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ value, onChange, placeholder = 'Filter work items...', resultCount }, ref) {
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
      </div>
    )
  }
)
