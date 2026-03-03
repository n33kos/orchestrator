import styles from './Breadcrumb.module.scss'

interface BreadcrumbProps {
  tab: string
  searchQuery?: string
  statusFilter?: string
  viewMode?: string
  itemCount: number
}

const TAB_LABELS: Record<string, string> = {
  projects: 'Projects',
  sessions: 'Sessions',
  delegators: 'Delegators',
  analytics: 'Analytics',
}

export function Breadcrumb({ tab, searchQuery, statusFilter, viewMode, itemCount }: BreadcrumbProps) {
  const parts: string[] = []
  parts.push(TAB_LABELS[tab] || tab)
  if (statusFilter) {
    parts.push(statusFilter)
  }
  if (searchQuery) {
    parts.push(`"${searchQuery}"`)
  }

  return (
    <div className={styles.Root}>
      <div className={styles.Parts}>
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className={styles.Separator}>/</span>}
            <span className={i === parts.length - 1 ? styles.Active : styles.Part}>{part}</span>
          </span>
        ))}
      </div>
      <span className={styles.Count}>
        {itemCount} item{itemCount !== 1 ? 's' : ''}
        {viewMode === 'compact' && <span className={styles.ViewLabel}> (compact)</span>}
      </span>
    </div>
  )
}
