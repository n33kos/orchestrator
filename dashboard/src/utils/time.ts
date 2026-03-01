const MINUTE = 60
const HOUR = 3600
const DAY = 86400
const WEEK = 604800

export function timeAgo(iso: string | null): string {
  if (!iso) return '--'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)

  if (diff < 0) return 'just now'
  if (diff < 10) return 'just now'
  if (diff < MINUTE) return `${diff}s ago`
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE)
    return `${m}m ago`
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    return `${h}h ago`
  }
  if (diff < WEEK) {
    const d = Math.floor(diff / DAY)
    return `${d}d ago`
  }
  const w = Math.floor(diff / WEEK)
  return `${w}w ago`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
