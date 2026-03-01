import { useState, useCallback, useEffect } from 'react'

export interface OrchestratorSettings {
  maxConcurrentProjects: number
  maxConcurrentQuickFixes: number
  pollIntervalMs: number
  autoActivate: boolean
  defaultDelegatorEnabled: boolean
  notificationsEnabled: boolean
  soundEnabled: boolean
}

const STORAGE_KEY = 'orchestrator-settings-config'

const DEFAULTS: OrchestratorSettings = {
  maxConcurrentProjects: 2,
  maxConcurrentQuickFixes: 4,
  pollIntervalMs: 5000,
  autoActivate: false,
  defaultDelegatorEnabled: true,
  notificationsEnabled: true,
  soundEnabled: false,
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const update = useCallback(<K extends keyof OrchestratorSettings>(key: K, value: OrchestratorSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULTS)
  }, [])

  return { settings, update, reset, open, setOpen }
}
