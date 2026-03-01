import styles from './Sparkline.module.scss'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
}

export function Sparkline({ data, width = 60, height = 20, color = 'var(--color-primary)' }: SparklineProps) {
  if (data.length < 2) return null

  const max = Math.max(...data, 1)
  const step = width / (data.length - 1)

  const points = data.map((val, i) => {
    const x = i * step
    const y = height - (val / max) * (height - 2)
    return `${x},${y}`
  }).join(' ')

  // Build the fill polygon (area under the line)
  const fillPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg className={styles.Root} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polygon points={fillPoints} fill={color} fillOpacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
