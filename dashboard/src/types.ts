export type WorkItemStatus = 'queued' | 'planning' | 'active' | 'review' | 'completed' | 'paused'
export type WorkItemType = string

export interface StackStep {
  position: number
  branch_suffix: string
  description: string
  completed: boolean
}

export interface WorkItem {
  id: string
  source: string
  title: string
  description: string
  type: WorkItemType
  priority: number
  status: WorkItemStatus
  branch: string
  pr_url: string | null
  worktree_path: string | null
  session_id: string | null
  delegator_id?: string | null
  delegator_enabled: boolean
  blocked_by: string[]
  created_at: string
  activated_at: string | null
  completed_at: string | null
  metadata: Record<string, unknown>
}

export interface QueueData {
  version: number
  items: WorkItem[]
}

export type SessionState = 'standby' | 'thinking' | 'responding' | 'zombie' | 'unknown'

export interface SessionInfo {
  id: string
  state: SessionState
  cwd: string
  tmux: string
}

export interface MessageEntry {
  id: string
  text: string
  timestamp: string
  direction: 'sent' | 'received'
}
