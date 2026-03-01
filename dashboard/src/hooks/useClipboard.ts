import { useState, useCallback, useRef } from 'react'

/**
 * Provides a copy-to-clipboard function with a `copied` feedback state
 * that auto-resets after a configurable timeout.
 */
export function useClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), resetMs)
      return true
    } catch {
      return false
    }
  }, [resetMs])

  return { copied, copy }
}
