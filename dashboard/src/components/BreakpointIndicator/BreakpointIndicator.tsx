import { useMediaQuery } from '../../hooks/useMediaQuery.ts'
import styles from './BreakpointIndicator.module.scss'

/**
 * Dev-only indicator showing current responsive breakpoint.
 * Only renders in development mode.
 */
export function BreakpointIndicator() {
  const isSm = useMediaQuery('(min-width: 640px)')
  const isMd = useMediaQuery('(min-width: 768px)')
  const isLg = useMediaQuery('(min-width: 1024px)')
  const isXl = useMediaQuery('(min-width: 1280px)')
  const is2xl = useMediaQuery('(min-width: 1536px)')

  if (import.meta.env.PROD) return null

  const breakpoint = is2xl ? '2xl' : isXl ? 'xl' : isLg ? 'lg' : isMd ? 'md' : isSm ? 'sm' : 'xs'

  return (
    <div className={styles.Root}>
      {breakpoint}
    </div>
  )
}
