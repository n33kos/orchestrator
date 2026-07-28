import { useState, useEffect, useCallback } from 'react'
import styles from './DiscoverPanel.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'

type FieldKind = 'text' | 'number' | 'boolean' | 'list' | 'select' | 'textarea'

interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  default: unknown
  help?: string
  options?: string[]
}

interface AdapterTypeSpec {
  label: string
  help?: string
  fields: FieldSpec[]
}

interface Adapter {
  name: string
  type: string
  enabled: boolean
  config: Record<string, unknown>
  defaults: Record<string, unknown>
  writeback: {
    enabled: boolean
    comment_on_import: boolean
    status_map: Record<string, string>
  }
  problems?: string[]
}

interface DiscoveredItem {
  title: string
  priority: number
  source?: string
  repo_key?: string
  new?: boolean
}

interface DiscoverPanelProps {
  onClose: () => void
}

const WRITEBACK_STATUSES = ['queued', 'planning', 'active', 'review', 'completed']

export function DiscoverPanel({ onClose }: DiscoverPanelProps) {
  const [types, setTypes] = useState<Record<string, AdapterTypeSpec>>({})
  const [adapters, setAdapters] = useState<Adapter[]>([])
  const [selected, setSelected] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<DiscoveredItem[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const trapRef = useFocusTrap<HTMLDivElement>()

  const load = useCallback(async () => {
    try {
      const [typesRes, sourcesRes] = await Promise.all([
        fetch('/api/discover/adapter-types'),
        fetch('/api/discover/sources'),
      ])
      if (typesRes.ok) setTypes((await typesRes.json()).types || {})
      if (sourcesRes.ok) setAdapters((await sourcesRes.json()).adapters || [])
    } catch {
      setStatus('Could not load adapter configuration')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const adapter = adapters[selected]
  const spec = adapter ? types[adapter.type] : undefined

  function mutate(change: (draft: Adapter) => void) {
    setAdapters(prev => prev.map((a, i) => {
      if (i !== selected) return a
      const draft = structuredClone(a)
      change(draft)
      return draft
    }))
    setDirty(true)
    setStatus('')
  }

  function addAdapter(type: string) {
    const fields = types[type]?.fields || []
    const config: Record<string, unknown> = {}
    for (const field of fields) config[field.key] = field.default
    setSelected(adapters.length)
    setAdapters(prev => [...prev, {
      name: `${type}-${prev.length + 1}`,
      type,
      enabled: false,
      config,
      defaults: { repo_key: '', priority: 3, commit_strategy: '', delegator_enabled: true },
      writeback: { enabled: false, comment_on_import: false, status_map: {} },
    }])
    setDirty(true)
  }

  function removeAdapter() {
    setAdapters(prev => prev.filter((_, i) => i !== selected))
    setSelected(0)
    setPreview(null)
    setDirty(true)
  }

  async function save() {
    setStatus('Saving...')
    try {
      const res = await fetch('/api/discover/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, adapters }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus(data.error || 'Save failed')
        return
      }
      setAdapters(data.adapters || adapters)
      setDirty(false)
      setStatus('Saved. The scheduler picks this up on its next discovery cycle.')
    } catch {
      setStatus('Save failed')
    }
  }

  async function runPreview() {
    if (!adapter) return
    setPreviewing(true)
    setPreview(null)
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, source: adapter.name }),
      })
      const data = await res.json()
      setPreview(data.items || [])
      if (!res.ok) setStatus(data.error || 'Preview failed')
    } catch {
      setStatus('Preview failed')
    }
    setPreviewing(false)
  }

  function renderField(field: FieldSpec) {
    const value = adapter!.config[field.key]

    let control
    switch (field.kind) {
      case 'boolean':
        control = (
          <button
            className={`${styles.Toggle} ${value ? styles.ToggleOn : ''}`}
            role="switch"
            aria-checked={!!value}
            onClick={() => mutate(d => { d.config[field.key] = !value })}
          >
            <span className={styles.ToggleKnob} />
          </button>
        )
        break
      case 'number':
        control = (
          <input
            className={styles.Input}
            type="number"
            value={String(value ?? '')}
            onChange={e => mutate(d => { d.config[field.key] = Number(e.target.value) })}
          />
        )
        break
      case 'select':
        control = (
          <select
            className={styles.Input}
            value={String(value ?? '')}
            onChange={e => mutate(d => { d.config[field.key] = e.target.value })}
          >
            {(field.options || []).map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        )
        break
      case 'list':
        control = (
          <input
            className={styles.Input}
            type="text"
            placeholder="comma separated"
            value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
            onChange={e => mutate(d => {
              d.config[field.key] = e.target.value
                .split(',')
                .map(part => part.trim())
                .filter(Boolean)
            })}
          />
        )
        break
      case 'textarea':
        control = (
          <textarea
            className={styles.Textarea}
            rows={3}
            value={String(value ?? '')}
            onChange={e => mutate(d => { d.config[field.key] = e.target.value })}
          />
        )
        break
      default:
        control = (
          <input
            className={styles.Input}
            type="text"
            value={String(value ?? '')}
            onChange={e => mutate(d => { d.config[field.key] = e.target.value })}
          />
        )
    }

    return (
      <div className={styles.Field} key={field.key}>
        <label className={styles.FieldLabel}>
          {field.label}
          {field.help && <span className={styles.FieldHelp}>{field.help}</span>}
        </label>
        <div className={styles.FieldControl}>{control}</div>
      </div>
    )
  }

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div className={styles.Panel} onClick={e => e.stopPropagation()} ref={trapRef}>
        <div className={styles.Header}>
          <div className={styles.Title}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Work Sources
          </div>
          <button className={styles.CloseButton} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.Body}>
          <p className={styles.Intro}>
            The scheduler polls every enabled adapter on its discovery interval. Imported
            items arrive queued with no plan, so they follow the normal plan-and-approve flow.
          </p>

          <div className={styles.SourceSection}>
            <div className={styles.SectionLabel}>Adapters</div>
            <div className={styles.SourceList}>
              {adapters.map((a, i) => (
                <button
                  key={`${a.name}-${i}`}
                  className={`${styles.SourceChip} ${i === selected ? styles.SourceChipActive : ''} ${a.enabled ? '' : styles.SourceChipOff}`}
                  onClick={() => { setSelected(i); setPreview(null) }}
                >
                  <span className={styles.SourceType}>{a.type}</span>
                  {a.name}
                </button>
              ))}
            </div>
            <div className={styles.AddRow}>
              {Object.entries(types).map(([type, typeSpec]) => (
                <button key={type} className={styles.AddButton} onClick={() => addAdapter(type)}>
                  + {typeSpec.label}
                </button>
              ))}
            </div>
          </div>

          {adapter && spec && (
            <div className={styles.Editor}>
              {!!adapter.problems?.length && (
                <div className={styles.Problems}>{adapter.problems.join('; ')}</div>
              )}

              <div className={styles.Field}>
                <label className={styles.FieldLabel}>Name</label>
                <div className={styles.FieldControl}>
                  <input
                    className={styles.Input}
                    type="text"
                    value={adapter.name}
                    onChange={e => mutate(d => { d.name = e.target.value })}
                  />
                </div>
              </div>

              <div className={styles.Field}>
                <label className={styles.FieldLabel}>
                  Enabled
                  {spec.help && <span className={styles.FieldHelp}>{spec.help}</span>}
                </label>
                <div className={styles.FieldControl}>
                  <button
                    className={`${styles.Toggle} ${adapter.enabled ? styles.ToggleOn : ''}`}
                    role="switch"
                    aria-checked={adapter.enabled}
                    onClick={() => mutate(d => { d.enabled = !d.enabled })}
                  >
                    <span className={styles.ToggleKnob} />
                  </button>
                </div>
              </div>

              <div className={styles.SectionLabel}>Filter</div>
              {spec.fields.map(renderField)}

              <div className={styles.SectionLabel}>Defaults for imported items</div>
              <div className={styles.Field}>
                <label className={styles.FieldLabel}>Repo key</label>
                <div className={styles.FieldControl}>
                  <input
                    className={styles.Input}
                    type="text"
                    value={String(adapter.defaults.repo_key ?? '')}
                    onChange={e => mutate(d => { d.defaults.repo_key = e.target.value })}
                  />
                </div>
              </div>
              <div className={styles.Field}>
                <label className={styles.FieldLabel}>
                  Delegator
                  <span className={styles.FieldHelp}>Run a delegator against imported items.</span>
                </label>
                <div className={styles.FieldControl}>
                  <button
                    className={`${styles.Toggle} ${adapter.defaults.delegator_enabled ? styles.ToggleOn : ''}`}
                    role="switch"
                    aria-checked={!!adapter.defaults.delegator_enabled}
                    onClick={() => mutate(d => { d.defaults.delegator_enabled = !d.defaults.delegator_enabled })}
                  >
                    <span className={styles.ToggleKnob} />
                  </button>
                </div>
              </div>

              <div className={styles.SectionLabel}>Status writeback</div>
              <div className={styles.Field}>
                <label className={styles.FieldLabel}>
                  Push status back
                  <span className={styles.FieldHelp}>
                    Update the source issue when this item changes status. Linear only.
                  </span>
                </label>
                <div className={styles.FieldControl}>
                  <button
                    className={`${styles.Toggle} ${adapter.writeback.enabled ? styles.ToggleOn : ''}`}
                    role="switch"
                    aria-checked={adapter.writeback.enabled}
                    onClick={() => mutate(d => { d.writeback.enabled = !d.writeback.enabled })}
                  >
                    <span className={styles.ToggleKnob} />
                  </button>
                </div>
              </div>
              {adapter.writeback.enabled && WRITEBACK_STATUSES.map(orchestratorStatus => (
                <div className={styles.Field} key={orchestratorStatus}>
                  <label className={styles.FieldLabel}>{orchestratorStatus}</label>
                  <div className={styles.FieldControl}>
                    <input
                      className={styles.Input}
                      type="text"
                      placeholder="leave blank to not sync"
                      value={adapter.writeback.status_map[orchestratorStatus] || ''}
                      onChange={e => mutate(d => {
                        if (e.target.value.trim()) {
                          d.writeback.status_map[orchestratorStatus] = e.target.value
                        } else {
                          delete d.writeback.status_map[orchestratorStatus]
                        }
                      })}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.Actions}>
            <button className={styles.DryRunButton} onClick={runPreview} disabled={previewing || !adapter}>
              {previewing ? 'Checking...' : 'Preview matches'}
            </button>
            <button className={styles.RunButton} onClick={save} disabled={!dirty}>
              {dirty ? 'Save' : 'Saved'}
            </button>
            {adapters.length > 1 && (
              <button className={styles.RemoveButton} onClick={removeAdapter}>Remove</button>
            )}
          </div>

          {preview && (
            <div className={styles.PreviewSection}>
              <div className={styles.SectionLabel}>
                {preview.length} matched, {preview.filter(item => item.new).length} not yet imported
              </div>
              <div className={styles.PreviewList}>
                {preview.map((item, i) => (
                  <div key={i} className={styles.PreviewItem}>
                    <span className={styles.PreviewPriority}>P{item.priority}</span>
                    <span className={styles.PreviewTitle}>{item.title}</span>
                    {!item.new && <span className={styles.PreviewType}>already queued</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {status && <div className={styles.LastRun}>{status}</div>}
        </div>
      </div>
    </div>
  )
}
