import { useState, useEffect, useCallback } from 'react'

const ZOOM_KEY = 'orchestrator:zoomLevel'
const MIN_ZOOM = 0.75
const MAX_ZOOM = 1.5
const STEP = 0.05

function getInitialZoom(): number {
  try {
    const stored = localStorage.getItem(ZOOM_KEY)
    if (stored) {
      const val = parseFloat(stored)
      if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) return val
    }
  } catch { /* ignore */ }
  return 1
}

export function useZoom() {
  const [zoom, setZoom] = useState(getInitialZoom)

  useEffect(() => {
    document.documentElement.style.fontSize = `${zoom * 100}%`
    localStorage.setItem(ZOOM_KEY, String(zoom))
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [zoom])

  const zoomIn = useCallback(() => {
    setZoom(prev => Math.min(MAX_ZOOM, Math.round((prev + STEP) * 100) / 100))
  }, [])

  const zoomOut = useCallback(() => {
    setZoom(prev => Math.max(MIN_ZOOM, Math.round((prev - STEP) * 100) / 100))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
  }, [])

  return {
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
  }
}
