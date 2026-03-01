import styles from './MetricCard.module.scss'

interface Props {
  label: string
  value: string | number
  change?: number
  icon?: React.ReactNode
  color?: string
}

export function MetricCard({ label, value, change, icon, color }: Props) {
  return (
    <div className={styles.Root}>
      {icon && (
        <div className={styles.Icon} style={color ? { color } : undefined}>
          {icon}
        </div>
      )}
      <div className={styles.Content}>
        <span className={styles.Label}>{label}</span>
        <span className={styles.Value} style={color ? { color } : undefined}>
          {value}
        </span>
        {change !== undefined && change !== 0 && (
          <span className={`${styles.Change} ${change > 0 ? styles.Up : styles.Down}`}>
            {change > 0 ? '+' : ''}{change}
          </span>
        )}
      </div>
    </div>
  )
}
