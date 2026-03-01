import styles from './ProgressSteps.module.scss'

interface Step {
  id: string
  label: string
  description?: string
}

interface Props {
  steps: Step[]
  currentStep: number
  onStepClick?: (index: number) => void
}

export function ProgressSteps({ steps, currentStep, onStepClick }: Props) {
  return (
    <div className={styles.Root}>
      {steps.map((step, i) => {
        const status = i < currentStep ? 'completed' : i === currentStep ? 'current' : 'upcoming'
        return (
          <div key={step.id} className={styles.Step}>
            <div className={styles.Indicator}>
              <button
                className={`${styles.Dot} ${styles[status]}`}
                onClick={onStepClick ? () => onStepClick(i) : undefined}
                type="button"
                disabled={!onStepClick}
                aria-label={`Step ${i + 1}: ${step.label}`}
              >
                {status === 'completed' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </button>
              {i < steps.length - 1 && (
                <div className={`${styles.Connector} ${i < currentStep ? styles.ConnectorActive : ''}`} />
              )}
            </div>
            <div className={styles.Content}>
              <span className={`${styles.Label} ${status === 'current' ? styles.LabelActive : ''}`}>
                {step.label}
              </span>
              {step.description && (
                <span className={styles.Description}>{step.description}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
