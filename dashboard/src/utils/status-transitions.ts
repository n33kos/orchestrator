import type { WorkItemStatus } from '../types.ts'

/**
 * Map of valid status transitions.
 * Each key lists the statuses it can transition to.
 */
const TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  queued: ['active', 'paused'],
  active: ['paused', 'review', 'completed'],
  paused: ['queued', 'active'],
  review: ['active', 'completed', 'queued'],
  completed: ['queued'],
}

export function getValidTransitions(current: WorkItemStatus): WorkItemStatus[] {
  return TRANSITIONS[current] ?? []
}

export function isValidTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function getTransitionLabel(status: WorkItemStatus): string {
  const labels: Record<WorkItemStatus, string> = {
    queued: 'Queue',
    active: 'Activate',
    paused: 'Pause',
    review: 'Review',
    completed: 'Complete',
  }
  return labels[status] ?? status
}
