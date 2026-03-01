import styles from './ProgressRing.module.scss'

interface Props {
  value: number  // 0-100
  size?: number
  strokeWidth?: number
  color?: string
  showLabel?: boolean
}

export function ProgressRing({
  value,
  size = 40,
  strokeWidth = 4,
  color = 'var(--color-primary)',
  showLabel = true,
}: Props) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference

  return (
    <div className={styles.Root} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={styles.Progress}
        />
      </svg>
      {showLabel && (
        <span className={styles.Label} style={{ fontSize: size * 0.28 }}>
          {Math.round(value)}%
        </span>
      )}
    </div>
  )
}
