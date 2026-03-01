import styles from './Switch.module.scss'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Switch({ checked, onChange, label, disabled, size = 'md' }: Props) {
  return (
    <label className={`${styles.Root} ${disabled ? styles.Disabled : ''} ${styles[size]}`}>
      <button
        className={`${styles.Track} ${checked ? styles.Checked : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        type="button"
      >
        <span className={styles.Knob} />
      </button>
      {label && <span className={styles.Label}>{label}</span>}
    </label>
  )
}
