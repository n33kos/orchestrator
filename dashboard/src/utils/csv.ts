import type { WorkItem } from '../types.ts'

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export function exportWorkItemsCsv(items: WorkItem[]): string {
  const headers = [
    'ID', 'Title', 'Description', 'Type', 'Status', 'Priority',
    'Branch', 'PR URL', 'Blocked By', 'Created At',
    'Activated At', 'Completed At',
  ]

  const rows = items.map(item => [
    item.id,
    item.title,
    item.description,
    item.type,
    item.status,
    String(item.priority),
    item.branch,
    item.pr_url || '',
    item.blocked_by.join('; '),
    item.created_at,
    item.activated_at || '',
    item.completed_at || '',
  ])

  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(',')),
  ]

  return csvLines.join('\n')
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
