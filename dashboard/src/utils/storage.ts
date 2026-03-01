interface StorageInfo {
  used: number
  items: { key: string; size: number }[]
}

export function getLocalStorageUsage(): StorageInfo {
  const items: { key: string; size: number }[] = []
  let total = 0

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      const value = localStorage.getItem(key) || ''
      const size = (key.length + value.length) * 2 // UTF-16 bytes
      items.push({ key, size })
      total += size
    }
  }

  items.sort((a, b) => b.size - a.size)
  return { used: total, items }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function clearOrchestratorStorage() {
  const prefix = 'orchestrator:'
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k))
  return keysToRemove.length
}
