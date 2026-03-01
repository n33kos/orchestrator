import styles from './Heatmap.module.scss'

interface HeatmapCell {
  label: string
  value: number
}

interface Props {
  data: HeatmapCell[][]
  rowLabels?: string[]
  colLabels?: string[]
  maxValue?: number
  colorStart?: string
  colorEnd?: string
}

function interpolateColor(value: number, max: number): string {
  const intensity = max > 0 ? value / max : 0
  const r = Math.round(59 + (34 - 59) * intensity)
  const g = Math.round(130 + (197 - 130) * intensity)
  const b = Math.round(246 + (94 - 246) * intensity)
  return `rgba(${r}, ${g}, ${b}, ${0.1 + intensity * 0.8})`
}

export function Heatmap({ data, rowLabels, colLabels, maxValue }: Props) {
  const max = maxValue ?? Math.max(...data.flat().map(c => c.value), 1)

  return (
    <div className={styles.Root}>
      {colLabels && (
        <div className={styles.ColLabels}>
          {rowLabels && <span className={styles.Corner} />}
          {colLabels.map((label, i) => (
            <span key={i} className={styles.ColLabel}>{label}</span>
          ))}
        </div>
      )}
      {data.map((row, ri) => (
        <div key={ri} className={styles.Row}>
          {rowLabels && <span className={styles.RowLabel}>{rowLabels[ri]}</span>}
          {row.map((cell, ci) => (
            <div
              key={ci}
              className={styles.Cell}
              style={{ backgroundColor: interpolateColor(cell.value, max) }}
              title={`${cell.label}: ${cell.value}`}
            >
              {cell.value > 0 && <span className={styles.CellValue}>{cell.value}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
