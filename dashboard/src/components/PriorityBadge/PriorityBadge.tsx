import styles from './PriorityBadge.module.scss'

interface PriorityBadgeProps {
  priority: number
  size?: 'sm' | 'md'
}

function getLevel(priority: number): 'critical' | 'high' | 'medium' | 'low' {
  if (priority <= 10) return 'critical'
  if (priority <= 25) return 'high'
  if (priority <= 50) return 'medium'
  return 'low'
}

const LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function PriorityBadge({ priority, size = 'sm' }: PriorityBadgeProps) {
  const level = getLevel(priority)
  return (
    <span
      className={`${styles.Root} ${styles[level]} ${styles[size]}`}
      title={`Priority ${priority} (${LABEL[level]})`}
    >
      {priority}
    </span>
  )
}
