import styles from './BarChart.module.scss'

interface Bar {
  label: string
  value: number
  color?: string
}

interface Props {
  bars: Bar[]
  height?: number
  showValues?: boolean
}

export function BarChart({ bars, height = 120, showValues = true }: Props) {
  const maxValue = Math.max(...bars.map(b => b.value), 1)

  return (
    <div className={styles.Root} style={{ height }}>
      <div className={styles.Bars}>
        {bars.map((bar, i) => {
          const pct = (bar.value / maxValue) * 100
          return (
            <div key={`${bar.label}-${i}`} className={styles.BarGroup}>
              <div className={styles.BarWrapper}>
                <div
                  className={styles.Bar}
                  style={{
                    height: `${pct}%`,
                    backgroundColor: bar.color || 'var(--color-primary)',
                  }}
                  title={`${bar.label}: ${bar.value}`}
                />
              </div>
              {showValues && <span className={styles.Value}>{bar.value}</span>}
              <span className={styles.Label}>{bar.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
