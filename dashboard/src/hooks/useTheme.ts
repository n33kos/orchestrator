import { useState, useCallback, useEffect } from 'react'

type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  try {
    const stored = JSON.parse(localStorage.getItem('orchestrator-settings') ?? '{}')
    if (stored.theme === 'light' || stored.theme === 'dark') return stored.theme
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      const settings = JSON.parse(localStorage.getItem('orchestrator-settings') ?? '{}')
      settings.theme = theme
      localStorage.setItem('orchestrator-settings', JSON.stringify(settings))
    } catch { /* ignore */ }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, toggle }
}
