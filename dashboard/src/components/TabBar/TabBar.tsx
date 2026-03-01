import classnames from 'classnames'
import styles from './TabBar.module.scss'

export interface Tab {
  id: string
  label: string
  count: number
}

interface TabBarProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div className={styles.Root}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={classnames(styles.Tab, tab.id === activeTab && styles.active)}
          onClick={() => onTabChange(tab.id)}
        >
          <span className={styles.TabLabel}>{tab.label}</span>
          <span className={styles.TabCount}>{tab.count}</span>
        </button>
      ))}
    </div>
  )
}
