import { useState, useRef } from 'react'
import styles from './ChipInput.module.scss'

interface Props {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  maxChips?: number
}

export function ChipInput({ values, onChange, placeholder = 'Type and press Enter...', maxChips }: Props) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const trimmed = input.trim()
      if (trimmed && !values.includes(trimmed)) {
        if (maxChips && values.length >= maxChips) return
        onChange([...values, trimmed])
      }
      setInput('')
    }

    if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function removeChip(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className={styles.Root} onClick={() => inputRef.current?.focus()}>
      {values.map((chip, i) => (
        <span key={`${chip}-${i}`} className={styles.Chip}>
          {chip}
          <button
            className={styles.Remove}
            onClick={(e) => { e.stopPropagation(); removeChip(i) }}
            type="button"
            aria-label={`Remove ${chip}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className={styles.Input}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={values.length === 0 ? placeholder : ''}
        disabled={maxChips !== undefined && values.length >= maxChips}
      />
    </div>
  )
}
