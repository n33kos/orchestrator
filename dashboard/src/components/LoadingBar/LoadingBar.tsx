import styles from './LoadingBar.module.scss'

interface LoadingBarProps {
  active: boolean
}

export function LoadingBar({ active }: LoadingBarProps) {
  if (!active) return null

  return (
    <div className={styles.Root}>
      <div className={styles.Bar} />
    </div>
  )
}
