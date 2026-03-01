import styles from './DiffViewer.module.scss'

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  content: string
  lineNumber: number
}

interface Props {
  before: string
  after: string
  title?: string
}

function computeDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const result: DiffLine[] = []

  const maxLen = Math.max(beforeLines.length, afterLines.length)
  let lineNum = 0

  // Simple line-by-line diff (not LCS, but sufficient for small diffs)
  const beforeSet = new Set(beforeLines)
  const afterSet = new Set(afterLines)

  // Lines only in before = removed
  for (const line of beforeLines) {
    if (!afterSet.has(line)) {
      lineNum++
      result.push({ type: 'removed', content: line, lineNumber: lineNum })
    }
  }

  lineNum = 0
  for (let i = 0; i < maxLen; i++) {
    lineNum++
    const bLine = beforeLines[i]
    const aLine = afterLines[i]

    if (bLine === aLine) {
      if (bLine !== undefined) {
        result.push({ type: 'unchanged', content: bLine, lineNumber: lineNum })
      }
    } else {
      if (bLine !== undefined && !afterSet.has(bLine)) {
        // already added above
      }
      if (aLine !== undefined && !beforeSet.has(aLine)) {
        result.push({ type: 'added', content: aLine, lineNumber: lineNum })
      } else if (aLine !== undefined) {
        result.push({ type: 'unchanged', content: aLine, lineNumber: lineNum })
      }
    }
  }

  return result
}

export function DiffViewer({ before, after, title }: Props) {
  const lines = computeDiff(before, after)

  if (lines.length === 0) {
    return <div className={styles.Root}><span className={styles.Empty}>No changes</span></div>
  }

  return (
    <div className={styles.Root}>
      {title && <div className={styles.Title}>{title}</div>}
      <div className={styles.Lines}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={`${styles.Line} ${
              line.type === 'added' ? styles.Added :
              line.type === 'removed' ? styles.Removed : ''
            }`}
          >
            <span className={styles.Prefix}>
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            <span className={styles.Content}>{line.content || '\u00A0'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
