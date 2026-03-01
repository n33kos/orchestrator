import { useState, useEffect } from 'react'
import styles from './ScrollToTop.module.scss'

interface ScrollToTopProps {
  scrollContainer?: HTMLElement | null
}

export function ScrollToTop({ scrollContainer }: ScrollToTopProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = scrollContainer
    if (!el) return

    function handleScroll() {
      setVisible(el!.scrollTop > 300)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollContainer])

  if (!visible) return null

  return (
    <button
      className={styles.Root}
      onClick={() => scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })}
      title="Scroll to top"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </button>
  )
}
