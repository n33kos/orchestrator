import styles from './AgeBadge.module.scss'
import classnames from 'classnames'

interface Props {
  createdAt: string
  className?: string
}

function getAgeCategory(hoursOld: number): 'fresh' | 'normal' | 'aging' | 'stale' {
  if (hoursOld < 1) return 'fresh'
  if (hoursOld < 24) return 'normal'
  if (hoursOld < 72) return 'aging'
  return 'stale'
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = ms / 3600000
  if (hours < 1) return `${Math.floor(ms / 60000)}m`
  if (hours < 24) return `${Math.floor(hours)}h`
  return `${Math.floor(hours / 24)}d`
}

export function AgeBadge({ createdAt, className }: Props) {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000
  const category = getAgeCategory(hours)

  return (
    <span
      className={classnames(styles.Root, styles[`Cat_${category}`], className)}
      title={`Age: ${formatAge(createdAt)} (${category})`}
    >
      {formatAge(createdAt)}
    </span>
  )
}
