import { useState, useEffect, useCallback } from 'react'
import styles from './DiscoverPanel.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'

interface DiscoveredItem {
  title: string
  type: string
  priority: number
  description?: string
  source?: string
}

interface SourceConfig {
  name: string
  type: string
  detail: string
}

interface DiscoverPanelProps {
  onClose: () => void
  onQueueRefresh: () => void
}

export function DiscoverPanel({ onClose, onQueueRefresh }: DiscoverPanelProps) {
  const [sources, setSources] = useState<SourceConfig[]>([])
  const [preview, setPreview] = useState<DiscoveredItem[]>([])
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [selectedSource, setSelectedSource] = useState<string>('')
  const [lastRun, setLastRun] = useState<string | null>(null)
  const trapRef = useFocusTrap<HTMLDivElement>()

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/discover/sources')
      if (res.ok) {
        const data = await res.json()
        setSources(data.sources || [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchSources() }, [fetchSources])

  async function handleDryRun() {
    setLoading(true)
    setPreview([])
    setOutput('')
    try {
      const body: Record<string, unknown> = { dryRun: true }
      if (selectedSource) body.source = selectedSource
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.items && Array.isArray(data.items)) {
          setPreview(data.items)
        }
        setOutput(data.output || 'No output')
      }
    } catch {
      setOutput('Failed to run dry-run discovery')
    }
    setLoading(false)
  }

  async function handleDiscover() {
    setRunning(true)
    try {
      const body: Record<string, unknown> = {}
      if (selectedSource) body.source = selectedSource
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setOutput(data.output || 'Discovery complete')
        setLastRun(new Date().toISOString())
        setPreview([])
        onQueueRefresh()
      }
    } catch {
      setOutput('Failed to run discovery')
    }
    setRunning(false)
  }

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div className={styles.Panel} onClick={e => e.stopPropagation()} ref={trapRef}>
        <div className={styles.Header}>
          <div className={styles.Title}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            Discover Work
          </div>
          <button className={styles.CloseButton} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.Body}>
          {sources.length > 0 && (
            <div className={styles.SourceSection}>
              <div className={styles.SectionLabel}>Sources</div>
              <div className={styles.SourceList}>
                <button
                  className={`${styles.SourceChip} ${!selectedSource ? styles.SourceChipActive : ''}`}
                  onClick={() => setSelectedSource('')}
                >
                  All
                </button>
                {sources.map(s => (
                  <button
                    key={s.name}
                    className={`${styles.SourceChip} ${selectedSource === s.name ? styles.SourceChipActive : ''}`}
                    onClick={() => setSelectedSource(s.name)}
                    title={`${s.type}: ${s.detail}`}
                  >
                    <span className={styles.SourceType}>{s.type}</span>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.Actions}>
            <button className={styles.DryRunButton} onClick={handleDryRun} disabled={loading}>
              {loading ? 'Scanning...' : 'Preview'}
            </button>
            <button className={styles.RunButton} onClick={handleDiscover} disabled={running}>
              {running ? 'Discovering...' : 'Discover & Add'}
            </button>
          </div>

          {preview.length > 0 && (
            <div className={styles.PreviewSection}>
              <div className={styles.SectionLabel}>
                {preview.length} new item{preview.length !== 1 ? 's' : ''} found
              </div>
              <div className={styles.PreviewList}>
                {preview.map((item, i) => (
                  <div key={i} className={styles.PreviewItem}>
                    <span className={styles.PreviewPriority}>P{item.priority}</span>
                    <span className={styles.PreviewTitle}>{item.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {output && !preview.length && (
            <div className={styles.OutputSection}>
              <pre className={styles.Output}>{output}</pre>
            </div>
          )}

          {lastRun && (
            <div className={styles.LastRun}>
              Last run: {new Date(lastRun).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
