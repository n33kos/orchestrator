import styles from './TimeRangeSelector.module.scss'

export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'all'

interface Props {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

const OPTIONS: { label: string; value: TimeRange }[] = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: 'All', value: 'all' },
]

export function getTimeRangeMs(range: TimeRange): number | null {
  switch (range) {
    case '1h': return 60 * 60 * 1000
    case '6h': return 6 * 60 * 60 * 1000
    case '24h': return 24 * 60 * 60 * 1000
    case '7d': return 7 * 24 * 60 * 60 * 1000
    case '30d': return 30 * 24 * 60 * 60 * 1000
    case 'all': return null
  }
}

export function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className={styles.Root}>
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          className={`${styles.Option} ${opt.value === value ? styles.Active : ''}`}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
