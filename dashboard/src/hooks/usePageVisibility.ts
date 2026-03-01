import { useState, useEffect } from 'react'

/**
 * Returns whether the page is currently visible to the user.
 * Useful for pausing polling/animations when the tab is in the background.
 */
export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(!document.hidden)

  useEffect(() => {
    function handleChange() {
      setVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', handleChange)
    return () => document.removeEventListener('visibilitychange', handleChange)
  }, [])

  return visible
}
