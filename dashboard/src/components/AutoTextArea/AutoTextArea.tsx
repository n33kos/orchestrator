import { useRef, useEffect } from 'react'
import styles from './AutoTextArea.module.scss'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxRows?: number
  minRows?: number
  className?: string
  disabled?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
}

export function AutoTextArea({
  value,
  onChange,
  placeholder,
  maxRows = 10,
  minRows = 1,
  className,
  disabled,
  onKeyDown,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20
    const maxHeight = lineHeight * maxRows + 16
    const minHeight = lineHeight * minRows + 16
    el.style.height = `${Math.min(maxHeight, Math.max(minHeight, el.scrollHeight))}px`
  }, [value, maxRows, minRows])

  return (
    <textarea
      ref={ref}
      className={`${styles.Root} ${className ?? ''}`}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={onKeyDown}
      rows={minRows}
    />
  )
}
