import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'orchestrator:accentColor'

const PRESETS = [
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Pink', value: '#ec4899' },
] as const

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!match) return null
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
}

function applyAccentColor(hex: string) {
  const rgb = hexToRgb(hex)
  if (!rgb) return
  const root = document.documentElement
  root.style.setProperty('--color-primary', hex)
  // Slightly lighter for hover
  root.style.setProperty('--color-primary-hover', `color-mix(in srgb, ${hex} 80%, white)`)
  root.style.setProperty('--color-primary-muted', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`)
}

function clearAccentColor() {
  const root = document.documentElement
  root.style.removeProperty('--color-primary')
  root.style.removeProperty('--color-primary-hover')
  root.style.removeProperty('--color-primary-muted')
}

export function useAccentColor() {
  const [accent, setAccent] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (accent) {
      applyAccentColor(accent)
      localStorage.setItem(STORAGE_KEY, accent)
    } else {
      clearAccentColor()
      localStorage.removeItem(STORAGE_KEY)
    }
    return () => clearAccentColor()
  }, [accent])

  const setColor = useCallback((color: string | null) => {
    setAccent(color)
  }, [])

  const reset = useCallback(() => {
    setAccent(null)
  }, [])

  return {
    accent,
    setColor,
    reset,
    presets: PRESETS,
  }
}
