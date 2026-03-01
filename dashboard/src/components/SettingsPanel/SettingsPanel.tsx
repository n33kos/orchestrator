import { useEffect, useRef } from 'react'
import styles from './SettingsPanel.module.scss'
import type { OrchestratorSettings } from '../../hooks/useSettings.ts'

interface SettingsPanelProps {
  settings: OrchestratorSettings
  onUpdate: <K extends keyof OrchestratorSettings>(key: K, value: OrchestratorSettings[K]) => void
  onReset: () => void
  onClose: () => void
  onExportQueue?: () => void
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className={styles.Row}>
      <div className={styles.RowInfo}>
        <span className={styles.RowLabel}>{label}</span>
        {description && <span className={styles.RowDescription}>{description}</span>}
      </div>
      <div className={styles.RowControl}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`${styles.Toggle} ${checked ? styles.ToggleOn : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={styles.ToggleKnob} />
    </button>
  )
}

export function SettingsPanel({ settings, onUpdate, onReset, onClose, onExportQueue }: SettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const pollOptions = [
    { label: '1s', value: 1000 },
    { label: '3s', value: 3000 },
    { label: '5s', value: 5000 },
    { label: '10s', value: 10000 },
    { label: '30s', value: 30000 },
  ]

  return (
    <div className={styles.Overlay}>
      <div className={styles.Panel} ref={panelRef}>
        <div className={styles.Header}>
          <h2 className={styles.Title}>Settings</h2>
          <button className={styles.CloseButton} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.Content}>
          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Concurrency</h3>
            <SettingRow label="Max projects" description="Maximum concurrent project work streams">
              <div className={styles.NumberControl}>
                <button
                  className={styles.NumberButton}
                  onClick={() => onUpdate('maxConcurrentProjects', Math.max(1, settings.maxConcurrentProjects - 1))}
                  disabled={settings.maxConcurrentProjects <= 1}
                >-</button>
                <span className={styles.NumberValue}>{settings.maxConcurrentProjects}</span>
                <button
                  className={styles.NumberButton}
                  onClick={() => onUpdate('maxConcurrentProjects', Math.min(8, settings.maxConcurrentProjects + 1))}
                  disabled={settings.maxConcurrentProjects >= 8}
                >+</button>
              </div>
            </SettingRow>
            <SettingRow label="Max quick fixes" description="Maximum concurrent quick fix work streams">
              <div className={styles.NumberControl}>
                <button
                  className={styles.NumberButton}
                  onClick={() => onUpdate('maxConcurrentQuickFixes', Math.max(1, settings.maxConcurrentQuickFixes - 1))}
                  disabled={settings.maxConcurrentQuickFixes <= 1}
                >-</button>
                <span className={styles.NumberValue}>{settings.maxConcurrentQuickFixes}</span>
                <button
                  className={styles.NumberButton}
                  onClick={() => onUpdate('maxConcurrentQuickFixes', Math.min(16, settings.maxConcurrentQuickFixes + 1))}
                  disabled={settings.maxConcurrentQuickFixes >= 16}
                >+</button>
              </div>
            </SettingRow>
          </div>

          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Polling</h3>
            <SettingRow label="Refresh interval" description="How often to poll the queue for updates">
              <div className={styles.SegmentControl}>
                {pollOptions.map(opt => (
                  <button
                    key={opt.value}
                    className={`${styles.Segment} ${settings.pollIntervalMs === opt.value ? styles.SegmentActive : ''}`}
                    onClick={() => onUpdate('pollIntervalMs', opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
          </div>

          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Automation</h3>
            <SettingRow label="Auto-activate" description="Automatically start queued items when a slot opens">
              <Toggle checked={settings.autoActivate} onChange={v => onUpdate('autoActivate', v)} />
            </SettingRow>
            <SettingRow label="Delegator by default" description="Enable delegator for new project work items">
              <Toggle checked={settings.defaultDelegatorEnabled} onChange={v => onUpdate('defaultDelegatorEnabled', v)} />
            </SettingRow>
          </div>

          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Notifications</h3>
            <SettingRow label="Browser notifications" description="Show notifications for status changes and completions">
              <Toggle checked={settings.notificationsEnabled} onChange={v => onUpdate('notificationsEnabled', v)} />
            </SettingRow>
            <SettingRow label="Sound effects" description="Play sounds on important events">
              <Toggle checked={settings.soundEnabled} onChange={v => onUpdate('soundEnabled', v)} />
            </SettingRow>
          </div>
        </div>

        {onExportQueue && (
          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Data</h3>
            <SettingRow label="Export queue" description="Download the current queue as a JSON file">
              <button className={styles.ExportButton} onClick={onExportQueue}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export JSON
              </button>
            </SettingRow>
          </div>
        )}

        <div className={styles.Footer}>
          <button className={styles.ResetButton} onClick={onReset}>
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
