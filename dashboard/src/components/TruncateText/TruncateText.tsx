import { useState, useRef, useEffect } from 'react'
import styles from './TruncateText.module.scss'

interface Props {
  text: string
  maxLines?: number
  className?: string
}

export function TruncateText({ text, maxLines = 2, className }: Props) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    setIsTruncated(el.scrollHeight > el.clientHeight + 1)
  }, [text, maxLines])

  return (
    <span className={`${styles.Root} ${className ?? ''}`}>
      <span
        ref={textRef}
        className={styles.Text}
        style={expanded ? undefined : {
          display: '-webkit-box',
          WebkitLineClamp: maxLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {text}
      </span>
      {isTruncated && (
        <button
          className={styles.Toggle}
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  )
}
