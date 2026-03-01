import { useState, useCallback, useEffect } from 'react'

export interface OrchestratorSettings {
  maxConcurrentProjects: number
  maxConcurrentQuickFixes: number
  pollIntervalMs: number
  autoActivate: boolean
  requireApprovedPlan: boolean
  plansDirectory: string
  defaultDelegatorEnabled: boolean
  notificationsEnabled: boolean
  soundEnabled: boolean
  archiveAfterDays: number
  stallThresholdMinutes: number
  delegatorCycleInterval: number
}

const STORAGE_KEY = 'orchestrator-settings-config'

// Keys that are synced to environment.yml via the config API
const CONFIG_SYNCED_KEYS = new Set<keyof OrchestratorSettings>([
  'maxConcurrentProjects',
  'maxConcurrentQuickFixes',
  'autoActivate',
  'requireApprovedPlan',
  'plansDirectory',
  'defaultDelegatorEnabled',
  'stallThresholdMinutes',
  'archiveAfterDays',
  'delegatorCycleInterval',
])

const DEFAULTS: OrchestratorSettings = {
  maxConcurrentProjects: 2,
  maxConcurrentQuickFixes: 4,
  pollIntervalMs: 5000,
  autoActivate: false,
  requireApprovedPlan: false,
  plansDirectory: '~/.claude/orchestrator/plans',
  defaultDelegatorEnabled: true,
  notificationsEnabled: true,
  soundEnabled: false,
  archiveAfterDays: 7,
  stallThresholdMinutes: 30,
  delegatorCycleInterval: 300,
}

export function useSettings() {
  const [settings, setSettings] = useState<OrchestratorSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return { ...DEFAULTS, ...JSON.parse(stored) }
    } catch { /* ignore */ }
    return DEFAULTS
  })

  const [open, setOpen] = useState(false)

  // On mount, fetch config-synced values from the API
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(config => {
        setSettings(prev => ({ ...prev, ...config }))
      })
      .catch(() => { /* use local values */ })
  }, [])

  // Persist to localStorage on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const update = useCallback(<K extends keyof OrchestratorSettings>(key: K, value: OrchestratorSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))

    // Sync config-backed settings to environment.yml
    if (CONFIG_SYNCED_KEYS.has(key)) {
      fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      }).catch(() => { /* best effort */ })
    }
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULTS)
    // Sync all config-backed defaults
    const configDefaults: Record<string, unknown> = {}
    for (const key of CONFIG_SYNCED_KEYS) {
      configDefaults[key] = DEFAULTS[key]
    }
    fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configDefaults),
    }).catch(() => { /* best effort */ })
  }, [])

  return { settings, update, reset, open, setOpen }
}
