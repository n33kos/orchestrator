/**
 * Parse clipboard text into work items.
 * Supports: JSON array, newline-separated titles, CSV.
 */
export interface ClipboardWorkItem {
  title: string
  description?: string
  type?: string
  priority?: number
}

export function parseClipboardItems(text: string): ClipboardWorkItem[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // Try JSON
  try {
    const parsed = JSON.parse(trimmed)
    const arr = Array.isArray(parsed) ? parsed : parsed.items
    if (Array.isArray(arr)) {
      return arr
        .filter((i: Record<string, unknown>) => i.title)
        .map((i: Record<string, unknown>) => ({
          title: String(i.title),
          description: i.description ? String(i.description) : undefined,
          type: i.type ? String(i.type) : undefined,
          priority: typeof i.priority === 'number' ? i.priority : undefined,
        }))
    }
  } catch { /* not JSON */ }

  // Try CSV (tab or comma delimited with header row)
  const lines = trimmed.split('\n').filter(l => l.trim())
  if (lines.length >= 2) {
    const firstLine = lines[0].toLowerCase()
    const delimiter = firstLine.includes('\t') ? '\t' : ','
    if (firstLine.includes('title')) {
      const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase())
      const titleIdx = headers.indexOf('title')
      const descIdx = headers.indexOf('description')
      const typeIdx = headers.indexOf('type')
      const priorityIdx = headers.indexOf('priority')

      if (titleIdx >= 0) {
        return lines.slice(1)
          .map(line => {
            const cols = line.split(delimiter).map(c => c.trim())
            return {
              title: cols[titleIdx] || '',
              description: descIdx >= 0 ? cols[descIdx] : undefined,
              type: typeIdx >= 0 ? cols[typeIdx] : undefined,
              priority: priorityIdx >= 0 && cols[priorityIdx] ? Number(cols[priorityIdx]) : undefined,
            }
          })
          .filter(i => i.title)
      }
    }
  }

  // Fall back to newline-separated titles
  return lines
    .map(l => l.trim())
    .filter(Boolean)
    .map(title => ({ title }))
}
