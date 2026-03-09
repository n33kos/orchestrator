import type { WorkItemStatus } from '../types.ts'

/**
 * Map of valid status transitions.
 * Each key lists the statuses it can transition to.
 */
const TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  queued: ['planning', 'active'],
  planning: ['active', 'queued'],
  active: ['review', 'completed'],
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
    planning: 'Plan',
    active: 'Activate',
    review: 'Review',
    completed: 'Complete',
  }
  return labels[status] ?? status
}
