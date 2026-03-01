import { useEffect } from 'react'

/**
 * Shows a browser-native confirmation dialog when the user tries to
 * navigate away or close the tab while there are unsaved changes.
 */
export function useBeforeUnload(hasChanges: boolean) {
  useEffect(() => {
    if (!hasChanges) return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      // Modern browsers ignore custom messages but require returnValue
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasChanges])
}
