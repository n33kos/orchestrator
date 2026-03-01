import styles from './MarkdownPreview.module.scss'

interface Props {
  source: string
  className?: string
}

/**
 * Lightweight inline markdown renderer supporting:
 * **bold**, *italic*, `code`, [links](url), - lists, # headings, > blockquotes
 * No external dependencies.
 */
export function MarkdownPreview({ source, className }: Props) {
  const html = renderMarkdown(source)

  return (
    <div
      className={`${styles.Root} ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInline(text: string): string {
  let result = escapeHtml(text)

  // Bold **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic *text*
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Code `text`
  result = result.replace(/`(.+?)`/g, '<code>$1</code>')
  // Links [text](url)
  result = result.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  )

  return result
}

function renderMarkdown(source: string): string {
  const lines = source.split('\n')
  const output: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      if (inList) { output.push('</ul>'); inList = false }
      output.push('<br />')
      continue
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      if (inList) { output.push('</ul>'); inList = false }
      const level = headingMatch[1].length
      output.push(`<h${level + 2}>${renderInline(headingMatch[2])}</h${level + 2}>`)
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      if (inList) { output.push('</ul>'); inList = false }
      output.push(`<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`)
      continue
    }

    // List items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { output.push('<ul>'); inList = true }
      output.push(`<li>${renderInline(trimmed.slice(2))}</li>`)
      continue
    }

    // Paragraph
    if (inList) { output.push('</ul>'); inList = false }
    output.push(`<p>${renderInline(trimmed)}</p>`)
  }

  if (inList) output.push('</ul>')
  return output.join('')
}
