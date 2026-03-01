import styles from './Badge.module.scss'

type Variant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'

interface Props {
  children: React.ReactNode
  variant?: Variant
  size?: 'sm' | 'md'
  dot?: boolean
  onClick?: () => void
}

export function Badge({ children, variant = 'default', size = 'sm', dot, onClick }: Props) {
  const Tag = onClick ? 'button' : 'span'

  return (
    <Tag
      className={`${styles.Root} ${styles[variant]} ${styles[size]} ${onClick ? styles.Clickable : ''}`}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {dot && <span className={styles.Dot} />}
      {children}
    </Tag>
  )
}
