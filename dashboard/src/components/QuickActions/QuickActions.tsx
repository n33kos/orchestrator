import styles from './QuickActions.module.scss'

interface QuickAction {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  onClick: () => void
  disabled?: boolean
}

interface Props {
  actions: QuickAction[]
}

export function QuickActions({ actions }: Props) {
  return (
    <div className={styles.Root}>
      {actions.map(action => (
        <button
          key={action.id}
          className={styles.Action}
          onClick={action.onClick}
          disabled={action.disabled}
          type="button"
          title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
        >
          <span className={styles.Icon}>{action.icon}</span>
          <span className={styles.Label}>{action.label}</span>
          {action.shortcut && (
            <kbd className={styles.Shortcut}>{action.shortcut}</kbd>
          )}
        </button>
      ))}
    </div>
  )
}
