import styles from './SessionMetrics.module.scss'
import type { SessionInfo } from '../../types.ts'

interface Props {
  sessions: SessionInfo[]
}

export function SessionMetrics({ sessions }: Props) {
  const total = sessions.length
  const active = sessions.filter(s => s.state === 'running' || s.state === 'standby').length
  const zombies = sessions.filter(s => s.state === 'zombie').length
  const idle = sessions.filter(s => s.state === 'idle').length

  const metrics = [
    { label: 'Total', value: total, color: 'var(--color-text)' },
    { label: 'Active', value: active, color: 'var(--color-success)' },
    { label: 'Idle', value: idle, color: 'var(--color-warning)' },
    { label: 'Zombie', value: zombies, color: 'var(--color-error)' },
  ]

  return (
    <div className={styles.Root}>
      {metrics.map(m => (
        <div key={m.label} className={styles.Metric}>
          <span className={styles.Value} style={{ color: m.color }}>{m.value}</span>
          <span className={styles.Label}>{m.label}</span>
        </div>
      ))}
    </div>
  )
}
