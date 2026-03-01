import { useState, useEffect, useCallback } from 'react'

/**
 * Syncs a state value to the URL hash.
 * The hash format is: #tab=projects&view=compact
 */
export function useHashParam(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    return params.get(key) || defaultValue
  })

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.slice(1)
      const params = new URLSearchParams(hash)
      const v = params.get(key)
      if (v !== null) {
        setValue(v)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [key])

  const setValueAndHash = useCallback((newValue: string) => {
    setValue(newValue)
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    params.set(key, newValue)
    window.location.hash = params.toString()
  }, [key])

  return [value, setValueAndHash]
}
