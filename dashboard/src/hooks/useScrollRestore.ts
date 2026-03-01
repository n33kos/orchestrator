import { useEffect, useRef } from 'react'

/**
 * Saves and restores scroll position per key (e.g., per tab).
 * Stores positions in a ref map so they persist across re-renders
 * but not page refreshes.
 */
export function useScrollRestore(key: string, container: HTMLElement | null) {
  const positions = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!container) return

    // Restore position for this key
    const saved = positions.current[key]
    if (saved !== undefined) {
      requestAnimationFrame(() => {
        container.scrollTop = saved
      })
    } else {
      container.scrollTop = 0
    }

    // Save position on scroll
    function handleScroll() {
      if (container) {
        positions.current[key] = container.scrollTop
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [key, container])
}
