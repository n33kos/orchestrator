import styles from './FormField.module.scss'

interface Props {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}

export function FormField({ label, htmlFor, error, hint, required, children }: Props) {
  return (
    <div className={`${styles.Root} ${error ? styles.HasError : ''}`}>
      <label className={styles.Label} htmlFor={htmlFor}>
        {label}
        {required && <span className={styles.Required}>*</span>}
      </label>
      {children}
      {error && <span className={styles.Error}>{error}</span>}
      {!error && hint && <span className={styles.Hint}>{hint}</span>}
    </div>
  )
}
