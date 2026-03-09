import styles from './SpendTrendChart.module.scss'
import type { DailySpendEntry } from '../../hooks/useSpend.ts'

interface Props {
  daily: DailySpendEntry[]
  height?: number
  days?: number
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function SpendTrendChart({ daily, height = 140, days = 30 }: Props) {
  // Filter to last N days and sort chronologically
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const filtered = daily
    .filter(d => d.date >= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (filtered.length === 0) {
    return (
      <div className={styles.Root}>
        <div className={styles.Empty}>No spend data available</div>
      </div>
    )
  }

  const costs = filtered.map(d => d.totalCost)
  const maxCost = Math.max(...costs, 0.01)
  const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length

  // Chart dimensions
  const padding = { top: 8, right: 8, bottom: 24, left: 44 }
  const chartWidth = 500
  const chartHeight = height
  const innerWidth = chartWidth - padding.left - padding.right
  const innerHeight = chartHeight - padding.top - padding.bottom

  // Scale helpers
  const xScale = (i: number) => padding.left + (i / Math.max(filtered.length - 1, 1)) * innerWidth
  const yScale = (v: number) => padding.top + innerHeight - (v / maxCost) * innerHeight

  // Build the line path
  const linePoints = filtered.map((d, i) => `${xScale(i)},${yScale(d.totalCost)}`)
  const linePath = `M ${linePoints.join(' L ')}`

  // Build the area path (fill under the line)
  const areaPath = `${linePath} L ${xScale(filtered.length - 1)},${yScale(0)} L ${xScale(0)},${yScale(0)} Z`

  // Average line y
  const avgY = yScale(avgCost)

  // X-axis labels — show ~5 evenly spaced labels
  const labelCount = Math.min(5, filtered.length)
  const labelIndices: number[] = []
  for (let i = 0; i < labelCount; i++) {
    labelIndices.push(Math.round((i / Math.max(labelCount - 1, 1)) * (filtered.length - 1)))
  }

  // Y-axis labels — show max and midpoint
  const yLabels = [
    { value: maxCost, y: yScale(maxCost) },
    { value: maxCost / 2, y: yScale(maxCost / 2) },
    { value: 0, y: yScale(0) },
  ]

  return (
    <div className={styles.Root}>
      <div className={styles.Chart}>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {yLabels.map((yl, i) => (
            <line
              key={i}
              x1={padding.left}
              x2={chartWidth - padding.right}
              y1={yl.y}
              y2={yl.y}
              stroke="var(--color-border)"
              strokeWidth={0.5}
            />
          ))}

          {/* Area fill */}
          <path
            d={areaPath}
            fill="var(--color-primary)"
            opacity={0.1}
          />

          {/* Spend line */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Average line */}
          <line
            x1={padding.left}
            x2={chartWidth - padding.right}
            y1={avgY}
            y2={avgY}
            stroke="var(--color-warning)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.7}
          />

          {/* Data points */}
          {filtered.map((d, i) => (
            <circle
              key={d.date}
              cx={xScale(i)}
              cy={yScale(d.totalCost)}
              r={filtered.length > 20 ? 1.5 : 2.5}
              fill="var(--color-primary)"
            >
              <title>{`${formatDateLabel(d.date)}: $${d.totalCost.toFixed(2)}`}</title>
            </circle>
          ))}

          {/* Y-axis labels */}
          {yLabels.map((yl, i) => (
            <text
              key={i}
              x={padding.left - 6}
              y={yl.y + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--color-text-muted)"
              fontFamily="var(--font-mono)"
            >
              ${yl.value.toFixed(yl.value >= 10 ? 0 : 2)}
            </text>
          ))}

          {/* X-axis labels */}
          {labelIndices.map(idx => (
            <text
              key={idx}
              x={xScale(idx)}
              y={chartHeight - 4}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-text-muted)"
            >
              {formatDateLabel(filtered[idx].date)}
            </text>
          ))}
        </svg>
      </div>
      <div className={styles.Summary}>
        <span>
          <span className={styles.SummaryDot} style={{ background: 'var(--color-primary)' }} />
          daily spend
        </span>
        <span>
          <span className={styles.SummaryDot} style={{ background: 'var(--color-warning)' }} />
          avg ${avgCost.toFixed(2)}/day
        </span>
      </div>
    </div>
  )
}
