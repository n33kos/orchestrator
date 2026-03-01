import classnames from 'classnames'
import styles from './TabBar.module.scss'

export interface Tab {
  id: string
  label: string
  count: number
  alertCount?: number
}

interface TabBarProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div className={styles.Root} role="tablist" aria-label="Dashboard sections">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={classnames(styles.Tab, tab.id === activeTab && styles.active)}
          onClick={() => onTabChange(tab.id)}
          role="tab"
          aria-selected={tab.id === activeTab}
          aria-label={`${tab.label}, ${tab.count} item${tab.count !== 1 ? 's' : ''}${tab.alertCount ? `, ${tab.alertCount} need attention` : ''}`}
        >
          <span className={styles.TabLabel}>{tab.label}</span>
          <span className={styles.TabCount}>{tab.count}</span>
          {tab.alertCount != null && tab.alertCount > 0 && (
            <span className={styles.AlertDot} aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  )
}
