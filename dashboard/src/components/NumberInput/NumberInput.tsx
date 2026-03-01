import styles from './NumberInput.module.scss'

interface Props {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  disabled?: boolean
}

export function NumberInput({ value, onChange, min, max, step = 1, label, disabled }: Props) {
  function decrement() {
    const next = value - step
    if (min !== undefined && next < min) return
    onChange(next)
  }

  function increment() {
    const next = value + step
    if (max !== undefined && next > max) return
    onChange(next)
  }

  return (
    <div className={`${styles.Root} ${disabled ? styles.Disabled : ''}`}>
      {label && <span className={styles.Label}>{label}</span>}
      <div className={styles.Controls}>
        <button
          className={styles.Button}
          onClick={decrement}
          disabled={disabled || (min !== undefined && value <= min)}
          type="button"
          aria-label="Decrease"
        >
          -
        </button>
        <input
          className={styles.Input}
          type="number"
          value={value}
          onChange={e => {
            const n = Number(e.target.value)
            if (!isNaN(n)) {
              if (min !== undefined && n < min) return
              if (max !== undefined && n > max) return
              onChange(n)
            }
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <button
          className={styles.Button}
          onClick={increment}
          disabled={disabled || (max !== undefined && value >= max)}
          type="button"
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  )
}
