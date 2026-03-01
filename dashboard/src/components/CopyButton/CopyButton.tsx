import { useState } from 'react'
import styles from './CopyButton.module.scss'

interface Props {
  text: string
  label?: string
  size?: 'sm' | 'md'
}

export function CopyButton({ text, label = 'Copy', size = 'sm' }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <button
      className={`${styles.Root} ${styles[size]} ${copied ? styles.Copied : ''}`}
      onClick={handleCopy}
      type="button"
      title={text}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
      {label && <span>{copied ? 'Copied!' : label}</span>}
    </button>
  )
}
