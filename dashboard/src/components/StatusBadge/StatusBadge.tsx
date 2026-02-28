import classnames from 'classnames'
import styles from './StatusBadge.module.scss'
import type { StatusBadgeProps } from './StatusBadge.types.d.ts'

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={classnames(styles.Root, styles[status])}>
      {status.replace('_', ' ')}
    </span>
  )
}
