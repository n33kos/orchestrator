import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import styles from './ErrorBoundary.module.scss'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.Root}>
          <div className={styles.Icon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className={styles.Title}>Something went wrong</h3>
          <p className={styles.Label}>{this.props.fallbackLabel || 'This section crashed unexpectedly.'}</p>
          {this.state.error && (
            <code className={styles.ErrorMessage}>{this.state.error.message}</code>
          )}
          <button className={styles.RetryButton} onClick={this.handleReset}>
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
