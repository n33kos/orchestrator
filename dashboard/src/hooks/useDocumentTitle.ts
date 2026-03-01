import { useEffect } from 'react'

interface TitleCounts {
  activeCount: number
  blockedCount: number
  zombieCount: number
}

export function useDocumentTitle({ activeCount, blockedCount, zombieCount }: TitleCounts) {
  useEffect(() => {
    const attentionCount = blockedCount + zombieCount
    const parts: string[] = []

    if (attentionCount > 0) {
      parts.push(`(${attentionCount})`)
    }

    if (activeCount > 0) {
      parts.push(`${activeCount} active`)
    }

    parts.push('Orchestrator')

    document.title = parts.join(' - ')

    return () => {
      document.title = 'Orchestrator'
    }
  }, [activeCount, blockedCount, zombieCount])
}
