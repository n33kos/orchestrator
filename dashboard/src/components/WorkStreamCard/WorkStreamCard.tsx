import classnames from 'classnames'
import styles from './WorkStreamCard.module.scss'
import { StatusBadge } from '../StatusBadge/StatusBadge.tsx'
import type { WorkItem } from '../../types.ts'

interface WorkStreamCardProps {
  item: WorkItem
}

export function WorkStreamCard({ item }: WorkStreamCardProps) {
  const hasSession = !!item.session_id
  const hasDelegator = !!item.delegator_id

  return (
    <div className={classnames(styles.Root, styles[item.status])}>
      <div className={styles.Header}>
        <div className={styles.TitleRow}>
          <span className={styles.Priority}>#{item.priority}</span>
          <h3 className={styles.Title}>{item.title}</h3>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <p className={styles.Description}>{item.description}</p>

      <div className={styles.Meta}>
        <span className={styles.MetaItem}>
          <span className={styles.MetaLabel}>Branch</span>
          <code className={styles.MetaValue}>{item.branch}</code>
        </span>

        <div className={styles.Indicators}>
          <span className={classnames(styles.Indicator, hasSession && styles.IndicatorActive)} title="Worker session">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </span>
          <span className={classnames(styles.Indicator, hasDelegator && styles.IndicatorActive)} title="Delegator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
          <span className={styles.TypeBadge}>{item.type === 'project' ? 'Project' : 'Quick Fix'}</span>
        </div>
      </div>
    </div>
  )
}
