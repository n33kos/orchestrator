import { useEffect } from 'react'
import classnames from 'classnames'
import styles from './ConfirmDialog.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const trapRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, onConfirm])

  return (
    <div className={styles.Overlay} onClick={onCancel}>
      <div className={styles.Dialog} ref={trapRef} onClick={e => e.stopPropagation()}>
        <h3 className={styles.Title}>{title}</h3>
        <p className={styles.Message}>{message}</p>
        <div className={styles.Actions}>
          <button className={styles.Button} onClick={onCancel}>Cancel</button>
          <button
            className={classnames(styles.Button, danger && styles.ButtonDanger)}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
