import type { ReactNode } from 'react'
import styles from './Markdown.module.scss'

interface MarkdownProps {
  children: string
  className?: string
}

/**
 * Renders the Markdown subset that plan files and issue bodies actually use:
 * headings, emphasis, inline and fenced code, links, blockquotes, rules, tables,
 * and both plain and task lists.
 *
 * Output is built as React elements rather than an HTML string, so untrusted
 * content can never reach the DOM as markup.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={className ? `${styles.Markdown} ${className}` : styles.Markdown}>
      {renderBlocks(children ?? '')}
    </div>
  )
}

const INLINE_PATTERN = new RegExp(
  [
    '`([^`]+)`', // code
    '\\*\\*([^*]+)\\*\\*', // bold
    '__([^_]+)__', // bold
    '~~([^~]+)~~', // strikethrough
    '\\*([^*\\n]+)\\*', // italic
    '(?<![A-Za-z0-9_])_([^_\\n]+)_(?![A-Za-z0-9_])', // italic
    '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', // link
    '(https?://[^\\s<>()]+)', // bare url
  ].join('|'),
  'g',
)

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let index = 0

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) nodes.push(text.slice(cursor, start))
    cursor = start + match[0].length

    const key = `${keyPrefix}-i${index++}`
    const [, code, boldStar, boldUnderscore, strike, italicStar, italicUnderscore, linkText, linkHref, bareUrl] = match

    if (code !== undefined) nodes.push(<code className={styles.InlineCode} key={key}>{code}</code>)
    else if (boldStar !== undefined || boldUnderscore !== undefined) nodes.push(<strong key={key}>{boldStar ?? boldUnderscore}</strong>)
    else if (strike !== undefined) nodes.push(<del key={key}>{strike}</del>)
    else if (italicStar !== undefined || italicUnderscore !== undefined) nodes.push(<em key={key}>{italicStar ?? italicUnderscore}</em>)
    else if (linkText !== undefined) nodes.push(
      <a className={styles.Link} href={linkHref} target="_blank" rel="noreferrer noopener" key={key}>{linkText}</a>,
    )
    else if (bareUrl !== undefined) nodes.push(
      <a className={styles.Link} href={bareUrl} target="_blank" rel="noreferrer noopener" key={key}>{bareUrl}</a>,
    )
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

interface ListItem {
  indent: number
  ordered: boolean
  checked: boolean | null
  text: string
}

function renderList(items: ListItem[], keyPrefix: string): ReactNode {
  const baseIndent = Math.min(...items.map(item => item.indent))
  const ordered = items[0].ordered
  const children: ReactNode[] = []
  let cursor = 0

  while (cursor < items.length) {
    const item = items[cursor]
    cursor += 1

    // Anything more deeply indented belongs to this item as a nested list.
    const nested: ListItem[] = []
    while (cursor < items.length && items[cursor].indent > baseIndent) {
      nested.push(items[cursor])
      cursor += 1
    }

    const key = `${keyPrefix}-li${children.length}`
    children.push(
      <li className={item.checked === null ? undefined : styles.TaskItem} key={key}>
        {item.checked !== null && (
          <input className={styles.Checkbox} type="checkbox" checked={item.checked} readOnly />
        )}
        <span>{renderInline(item.text, key)}</span>
        {nested.length > 0 && renderList(nested, key)}
      </li>,
    )
  }

  return ordered
    ? <ol className={styles.List} key={`${keyPrefix}-ol`}>{children}</ol>
    : <ul className={styles.List} key={`${keyPrefix}-ul`}>{children}</ul>
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim())
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let cursor = 0
  let key = 0

  const nextKey = () => `b${key++}`

  while (cursor < lines.length) {
    const line = lines[cursor]

    if (!line.trim()) {
      cursor += 1
      continue
    }

    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/)
    if (fence) {
      const body: string[] = []
      cursor += 1
      while (cursor < lines.length && !/^\s*```/.test(lines[cursor])) {
        body.push(lines[cursor])
        cursor += 1
      }
      cursor += 1
      blocks.push(
        <pre className={styles.CodeBlock} key={nextKey()}>
          <code data-language={fence[1] || undefined}>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const Tag = `h${Math.min(level + 1, 6)}` as 'h2'
      const id = nextKey()
      blocks.push(
        <Tag className={styles[`Heading${level}`] ?? styles.Heading3} key={id}>
          {renderInline(heading[2], id)}
        </Tag>,
      )
      cursor += 1
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) {
      blocks.push(<hr className={styles.Rule} key={nextKey()} />)
      cursor += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (cursor < lines.length && /^\s*>/.test(lines[cursor])) {
        body.push(lines[cursor].replace(/^\s*>\s?/, ''))
        cursor += 1
      }
      const id = nextKey()
      blocks.push(
        <blockquote className={styles.Quote} key={id}>{renderInline(body.join(' '), id)}</blockquote>,
      )
      continue
    }

    if (line.includes('|') && cursor + 1 < lines.length && isTableDivider(lines[cursor + 1])) {
      const header = splitRow(line)
      cursor += 2
      const rows: string[][] = []
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
        rows.push(splitRow(lines[cursor]))
        cursor += 1
      }
      const id = nextKey()
      blocks.push(
        <div className={styles.TableWrap} key={id}>
          <table className={styles.Table}>
            <thead>
              <tr>{header.map((cell, i) => <th key={i}>{renderInline(cell, `${id}-h${i}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell, `${id}-c${r}-${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (listMatch) {
      const items: ListItem[] = []
      while (cursor < lines.length) {
        const current = lines[cursor].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
        if (!current) {
          // A blank line inside a list is tolerated; anything else ends it.
          if (!lines[cursor].trim() && cursor + 1 < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[cursor + 1])) {
            cursor += 1
            continue
          }
          break
        }
        const task = current[3].match(/^\[([ xX])\]\s*(.*)$/)
        items.push({
          indent: current[1].length,
          ordered: /\d/.test(current[2]),
          checked: task ? task[1].toLowerCase() === 'x' : null,
          text: task ? task[2] : current[3],
        })
        cursor += 1
      }
      blocks.push(renderList(items, nextKey()))
      continue
    }

    const paragraph: string[] = []
    while (
      cursor < lines.length &&
      lines[cursor].trim() &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[cursor]) &&
      !/^\s*(#{1,6}\s|>|```)/.test(lines[cursor])
    ) {
      paragraph.push(lines[cursor].trim())
      cursor += 1
    }
    const id = nextKey()
    blocks.push(<p className={styles.Paragraph} key={id}>{renderInline(paragraph.join(' '), id)}</p>)
  }

  return blocks
}
