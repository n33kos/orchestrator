import styles from './StatusChart.module.scss'

interface Props {
  active: number
  queued: number
  review: number
  paused: number
  completed: number
}

const COLORS: Record<string, string> = {
  active: 'var(--color-success)',
  queued: 'var(--color-warning)',
  review: 'var(--color-primary)',
  paused: 'var(--color-error)',
  completed: 'var(--color-text-muted)',
}

export function StatusChart({ active, queued, review, paused, completed }: Props) {
  const total = active + queued + review + paused + completed
  if (total === 0) return null

  const segments = [
    { key: 'active', count: active },
    { key: 'queued', count: queued },
    { key: 'review', count: review },
    { key: 'paused', count: paused },
    { key: 'completed', count: completed },
  ].filter(s => s.count > 0)

  const size = 48
  const radius = 18
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className={styles.Root} title={`${active} active, ${queued} queued, ${review} review, ${paused} paused, ${completed} completed`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map(seg => {
          const pct = seg.count / total
          const dashLength = pct * circumference
          const dashOffset = -offset * circumference
          offset += pct
          return (
            <circle
              key={seg.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={COLORS[seg.key]}
              strokeWidth="6"
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )
        })}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className={styles.CenterText}
        >
          {total}
        </text>
      </svg>
    </div>
  )
}
