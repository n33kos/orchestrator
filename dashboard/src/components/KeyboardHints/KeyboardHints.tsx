import styles from './KeyboardHints.module.scss'

export function KeyboardHints() {
  return (
    <div className={styles.Root}>
      <span className={styles.Hint}><kbd className={styles.Key}>N</kbd> New</span>
      <span className={styles.Hint}><kbd className={styles.Key}>/</kbd> Search</span>
      <span className={styles.Hint}><kbd className={styles.Key}>R</kbd> Refresh</span>
      <span className={styles.Hint}><kbd className={styles.Key}>&#8984;K</kbd> Commands</span>
      <span className={styles.Hint}><kbd className={styles.Key}>Esc</kbd> Close</span>
    </div>
  )
}
