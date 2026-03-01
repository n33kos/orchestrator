import styles from './Tabs.module.scss'

interface Tab {
  id: string
  label: string
  count?: number
  disabled?: boolean
}

interface Props {
  tabs: Tab[]
  activeId: string
  onChange: (id: string) => void
  size?: 'sm' | 'md'
}

/**
 * Generic reusable tab component (different from the top-level TabBar).
 * Can be used in panels, modals, settings, etc.
 */
export function Tabs({ tabs, activeId, onChange, size = 'md' }: Props) {
  return (
    <div className={`${styles.Root} ${styles[size]}`} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`${styles.Tab} ${tab.id === activeId ? styles.Active : ''}`}
          onClick={() => onChange(tab.id)}
          disabled={tab.disabled}
          type="button"
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={styles.Count}>{tab.count}</span>
          )}
        </button>
      ))}
      <div className={styles.Indicator} />
    </div>
  )
}
