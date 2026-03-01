import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Detects user inactivity based on mouse/keyboard/touch events.
 * Returns whether the user is idle and a function to manually reset.
 */
export function useIdleDetection(timeoutMs = 300000): { idle: boolean; reset: () => void } {
  const [idle, setIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const reset = useCallback(() => {
    setIdle(false)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setIdle(true), timeoutMs)
  }, [timeoutMs])

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']

    function handleActivity() {
      reset()
    }

    events.forEach(e => document.addEventListener(e, handleActivity, { passive: true }))
    reset()

    return () => {
      events.forEach(e => document.removeEventListener(e, handleActivity))
      clearTimeout(timerRef.current)
    }
  }, [reset])

  return { idle, reset }
}
