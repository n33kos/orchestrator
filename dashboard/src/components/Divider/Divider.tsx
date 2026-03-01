import styles from './Divider.module.scss'

interface Props {
  label?: string
  spacing?: 'sm' | 'md' | 'lg'
  orientation?: 'horizontal' | 'vertical'
}

export function Divider({ label, spacing = 'md', orientation = 'horizontal' }: Props) {
  if (orientation === 'vertical') {
    return <div className={`${styles.Vertical} ${styles[spacing]}`} />
  }

  if (label) {
    return (
      <div className={`${styles.Labeled} ${styles[spacing]}`}>
        <div className={styles.Line} />
        <span className={styles.Label}>{label}</span>
        <div className={styles.Line} />
      </div>
    )
  }

  return <div className={`${styles.Horizontal} ${styles[spacing]}`} />
}
