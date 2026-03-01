import { useEffect, useRef } from 'react'
import styles from './ShortcutSheet.module.scss'
import { useFocusTrap } from '../../hooks/useFocusTrap.ts'

interface Props {
  onClose: () => void
}

const GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['j'], desc: 'Move focus down' },
      { keys: ['k'], desc: 'Move focus up' },
      { keys: ['Enter'], desc: 'Open focused item' },
      { keys: ['1-5'], desc: 'Switch tabs' },
      { keys: ['/'], desc: 'Focus search' },
      { keys: ['Esc'], desc: 'Close / go back' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['n'], desc: 'New work item' },
      { keys: ['r'], desc: 'Refresh queue' },
      { keys: ['v'], desc: 'Toggle view mode' },
      { keys: ['\u2318', 'k'], desc: 'Command palette' },
      { keys: ['\u2318', 'a'], desc: 'Select all' },
      { keys: ['\u2318', '\u21E7', 'f'], desc: 'Global search' },
    ],
  },
  {
    title: 'Zoom',
    shortcuts: [
      { keys: ['\u2318', '='], desc: 'Zoom in' },
      { keys: ['\u2318', '-'], desc: 'Zoom out' },
      { keys: ['\u2318', '0'], desc: 'Reset zoom' },
    ],
  },
  {
    title: 'Help',
    shortcuts: [
      { keys: ['?'], desc: 'Show this sheet' },
    ],
  },
]

export function ShortcutSheet({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className={styles.Overlay} onClick={onClose}>
      <div ref={containerRef} className={styles.Sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.Header}>
          <h2 className={styles.Title}>Keyboard Shortcuts</h2>
          <button className={styles.CloseButton} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.Body}>
          {GROUPS.map(group => (
            <div key={group.title} className={styles.Group}>
              <h3 className={styles.GroupTitle}>{group.title}</h3>
              {group.shortcuts.map(s => (
                <div key={s.desc} className={styles.Row}>
                  <div className={styles.Keys}>
                    {s.keys.map((key, i) => (
                      <span key={i}>
                        <kbd className={styles.Key}>{key}</kbd>
                        {i < s.keys.length - 1 && <span className={styles.Plus}>+</span>}
                      </span>
                    ))}
                  </div>
                  <span className={styles.Desc}>{s.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
