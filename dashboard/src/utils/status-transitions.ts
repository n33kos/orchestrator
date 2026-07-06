import type { WorkItemStatus } from '../types.ts'

/**
 * Map of valid status transitions.
 * Each key lists the statuses it can transition to.
 */
const TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  queued: ['planning', 'active', 'cancelled'],
  planning: ['active', 'queued', 'cancelled'],
  active: ['review', 'completed', 'cancelled'],
  review: ['active', 'completed', 'queued', 'cancelled'],
  completed: ['queued'],
  cancelled: ['queued'],
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
    planning: 'Plan',
    active: 'Activate',
    review: 'Review',
    completed: 'Complete',
    cancelled: 'Cancel',
  }
  return labels[status] ?? status
}
