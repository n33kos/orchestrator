import styles from './WelcomeGuide.module.scss'

interface Props {
  onDismiss: () => void
  onAddItem: () => void
  onOpenSettings: () => void
}

const STEPS = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
    title: 'Add work items',
    desc: 'Press N or click the + button to add projects and quick fixes to your queue.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: 'Manage sessions',
    desc: 'Work items activate into worktrees with Claude sessions. Monitor and message them from the Sessions tab.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    title: 'Search and filter',
    desc: 'Press / to search. Use filter chips to narrow by status. Press V to switch view modes.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
    title: 'Stay updated',
    desc: 'Enable notifications in settings. Toasts and sounds keep you aware of status changes.',
  },
]

export function WelcomeGuide({ onDismiss, onAddItem, onOpenSettings }: Props) {
  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <h2 className={styles.Title}>Welcome to Orchestrator</h2>
        <p className={styles.Subtitle}>Your autonomous work management dashboard. Here is how to get started:</p>
      </div>
      <div className={styles.Steps}>
        {STEPS.map((step, i) => (
          <div key={i} className={styles.Step}>
            <div className={styles.StepIcon}>{step.icon}</div>
            <div className={styles.StepContent}>
              <span className={styles.StepTitle}>{step.title}</span>
              <span className={styles.StepDesc}>{step.desc}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.Actions}>
        <button className={styles.PrimaryAction} onClick={onAddItem}>
          Add your first item
        </button>
        <button className={styles.SecondaryAction} onClick={onOpenSettings}>
          Configure settings
        </button>
        <button className={styles.DismissAction} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <div className={styles.Hint}>
        Press <kbd className={styles.Kbd}>?</kbd> anytime to see all keyboard shortcuts
      </div>
    </div>
  )
}
