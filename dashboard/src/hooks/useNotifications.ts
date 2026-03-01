import { useCallback, useEffect, useRef } from 'react'
import type { WorkItem } from '../types.ts'

export function useNotifications(items: WorkItem[], enabled: boolean) {
  const prevItemsRef = useRef<Map<string, string>>(new Map())
  const permissionGranted = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      permissionGranted.current = true
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        permissionGranted.current = p === 'granted'
      })
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !permissionGranted.current) return
    if (prevItemsRef.current.size === 0) {
      // First load — just record state, don't notify
      const map = new Map<string, string>()
      for (const item of items) map.set(item.id, item.status)
      prevItemsRef.current = map
      return
    }

    for (const item of items) {
      const prevStatus = prevItemsRef.current.get(item.id)
      if (prevStatus && prevStatus !== item.status) {
        new Notification(`Work item ${item.status}`, {
          body: item.title,
          icon: '/icons/icon-192.png',
          tag: `status-${item.id}`,
        })
      }
    }

    const map = new Map<string, string>()
    for (const item of items) map.set(item.id, item.status)
    prevItemsRef.current = map
  }, [items, enabled])

  const notify = useCallback((title: string, body: string) => {
    if (!enabled || !permissionGranted.current) return
    new Notification(title, { body, icon: '/icons/icon-192.png' })
  }, [enabled])

  return { notify }
}
