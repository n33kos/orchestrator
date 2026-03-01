import styles from './ColorPicker.module.scss'

interface Props {
  value: string
  onChange: (color: string) => void
  presets?: string[]
  label?: string
}

const DEFAULT_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#1d4ed8',
]

export function ColorPicker({ value, onChange, presets = DEFAULT_PRESETS, label }: Props) {
  return (
    <div className={styles.Root}>
      {label && <span className={styles.Label}>{label}</span>}
      <div className={styles.Swatches}>
        {presets.map(color => (
          <button
            key={color}
            className={`${styles.Swatch} ${color === value ? styles.Active : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            type="button"
            aria-label={color}
          />
        ))}
      </div>
      <div className={styles.CustomRow}>
        <input
          type="color"
          className={styles.ColorInput}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <input
          type="text"
          className={styles.HexInput}
          value={value}
          onChange={e => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
          }}
          maxLength={7}
          placeholder="#000000"
        />
      </div>
    </div>
  )
}
