import { useState, useRef, useEffect } from 'react'
import styles from './RelativeTime.module.scss'
import { timeAgo, formatDateTime } from '../../utils/time.ts'

interface Props {
  iso: string | null
  className?: string
}

export function RelativeTime({ iso, className }: Props) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [position, setPosition] = useState<'above' | 'below'>('above')
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (showTooltip && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPosition(rect.top < 60 ? 'below' : 'above')
    }
  }, [showTooltip])

  if (!iso) return <span className={className}>--</span>

  return (
    <span
      ref={ref}
      className={`${styles.Root} ${className || ''}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {timeAgo(iso)}
      {showTooltip && (
        <span className={`${styles.Tooltip} ${position === 'below' ? styles.TooltipBelow : ''}`}>
          {formatDateTime(iso)}
        </span>
      )}
    </span>
  )
}
