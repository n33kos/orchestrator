import styles from './ProgressBar.module.scss'
import type { WorkItemStatus } from '../../types.ts'

interface ProgressBarProps {
  status: WorkItemStatus
}

const STEPS: WorkItemStatus[] = ['queued', 'active', 'review', 'completed']
const LABEL: Record<string, string> = {
  queued: 'Queued',
  planning: 'Planning',
  active: 'Active',
  review: 'In Review',
  completed: 'Completed',
}

function getProgress(status: WorkItemStatus): number {
  if (status === 'planning') return 15
  const idx = STEPS.indexOf(status)
  if (idx < 0) return 0
  return ((idx + 1) / STEPS.length) * 100
}

function getColor(status: WorkItemStatus): string {
  if (status === 'completed') return 'var(--color-success)'
  if (status === 'review') return 'var(--color-warning)'
  return 'var(--color-primary)'
}

export function ProgressBar({ status }: ProgressBarProps) {
  const pct = getProgress(status)
  const color = getColor(status)

  return (
    <div className={styles.Root} title={`${LABEL[status] || status} (${Math.round(pct)}%)`}>
      <div className={styles.Track}>
        <div
          className={styles.Fill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className={styles.Steps}>
        {STEPS.map((step, i) => {
          const reached = pct >= ((i + 1) / STEPS.length) * 100
          return (
            <div
              key={step}
              className={`${styles.Dot} ${reached ? styles.DotReached : ''}`}
              style={reached ? { background: color } : undefined}
              title={LABEL[step]}
            />
          )
        })}
      </div>
    </div>
  )
}
