import { useMediaQuery } from './useMediaQuery.ts'

/**
 * Returns true when the user has requested reduced motion
 * via their OS accessibility settings.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
