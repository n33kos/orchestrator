import styles from './Avatar.module.scss'

interface Props {
  name: string
  size?: number
  src?: string
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
]

function getColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ name, size = 32, src }: Props) {
  if (src) {
    return (
      <img
        className={styles.Root}
        src={src}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={styles.Root}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: getColor(name),
      }}
      title={name}
    >
      {getInitials(name)}
    </div>
  )
}
