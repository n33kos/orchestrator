interface ShareState {
  tab?: string
  status?: string
  search?: string
  view?: string
}

export function buildShareUrl(state: ShareState): string {
  const params = new URLSearchParams()
  if (state.tab && state.tab !== 'projects') params.set('tab', state.tab)
  if (state.status && state.status !== 'all') params.set('status', state.status)
  if (state.search) params.set('q', state.search)
  if (state.view && state.view !== 'cards') params.set('view', state.view)

  const hash = params.toString()
  return `${window.location.origin}${window.location.pathname}${hash ? '#' + hash : ''}`
}

export async function copyShareUrl(state: ShareState): Promise<boolean> {
  const url = buildShareUrl(state)
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}
