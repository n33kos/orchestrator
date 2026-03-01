export type WorkItemStatus = 'queued' | 'planning' | 'active' | 'review' | 'completed' | 'paused'
export type WorkItemType = 'project' | 'quick_fix'

export interface WorkItem {
  id: string
  source: string
  title: string
  description: string
  type: WorkItemType
  priority: number
  status: WorkItemStatus
  branch: string
  worktree_path: string | null
  session_id: string | null
  delegator_id: string | null
  delegator_enabled: boolean
  created_at: string
  activated_at: string | null
  completed_at: string | null
  metadata: Record<string, unknown>
}

export interface QueueData {
  version: number
  items: WorkItem[]
}
