import { useState } from 'react'
import styles from './FloatingActionButton.module.scss'
import classnames from 'classnames'

interface Action {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

interface Props {
  actions: Action[]
}

export function FloatingActionButton({ actions }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.Root}>
      {open && (
        <div className={styles.Menu}>
          {actions.map((action, i) => (
            <button
              key={i}
              className={styles.MenuItem}
              onClick={() => { action.onClick(); setOpen(false) }}
              title={action.label}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className={styles.MenuIcon}>{action.icon}</span>
              <span className={styles.MenuLabel}>{action.label}</span>
            </button>
          ))}
        </div>
      )}
      {open && <div className={styles.Backdrop} onClick={() => setOpen(false)} />}
      <button
        className={classnames(styles.Fab, open && styles.FabOpen)}
        onClick={() => setOpen(!open)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  )
}
