import { useState, useEffect } from 'react'

/**
 * Returns whether a CSS media query matches.
 * Updates dynamically when the match state changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)

    function handleChange(e: MediaQueryListEvent) {
      setMatches(e.matches)
    }

    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [query])

  return matches
}
