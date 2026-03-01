import { useEffect, useRef } from 'react'

export function useFaviconBadge(hasAttention: boolean) {
  const originalHref = useRef<string | null>(null)

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return

    if (!originalHref.current) {
      originalHref.current = link.href
    }

    if (!hasAttention) {
      link.href = originalHref.current
      return
    }

    // Draw favicon with badge
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(img, 0, 0, 64, 64)

      // Draw red dot badge
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.arc(52, 12, 10, 0, Math.PI * 2)
      ctx.fill()

      // White border around badge
      ctx.strokeStyle = '#0a0a0f'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(52, 12, 10, 0, Math.PI * 2)
      ctx.stroke()

      link.href = canvas.toDataURL('image/png')
    }
    img.src = originalHref.current

    return () => {
      if (originalHref.current && link) {
        link.href = originalHref.current
      }
    }
  }, [hasAttention])
}
