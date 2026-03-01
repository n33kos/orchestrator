import styles from './ProgressOverlay.module.scss'

interface Props {
  message: string
  progress?: number // 0-100, undefined for indeterminate
}

export function ProgressOverlay({ message, progress }: Props) {
  return (
    <div className={styles.Root}>
      <div className={styles.Card}>
        <div className={styles.Spinner} />
        <span className={styles.Message}>{message}</span>
        {progress !== undefined && (
          <div className={styles.BarOuter}>
            <div className={styles.BarInner} style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        )}
        {progress !== undefined && (
          <span className={styles.Percent}>{Math.round(progress)}%</span>
        )}
      </div>
    </div>
  )
}
