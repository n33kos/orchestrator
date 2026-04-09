export type WorkItemStatus = 'queued' | 'planning' | 'active' | 'review' | 'completed'

export interface StackStep {
  position: number
  branch_suffix: string
  description: string
  completed: boolean
}

export interface WorkItemEnvironment {
  repo: string | null
  use_worktree: boolean
  branch: string | null
  worktree_path: string | null
  session_id: string | null
}

export interface WorkItemWorker {
  commit_strategy: 'branch_and_pr' | 'commit_to_main' | 'graphite_stack'
  delegator_enabled: boolean
  directives_enabled?: boolean
  stack_steps?: StackStep[]
}

export interface WorkItemPlan {
  file: string | null
  summary: string | null
  approved: boolean
  approved_at: string | null
}

export interface WorkItemRuntime {
  delegator_status: string | null
  spend: Record<string, unknown> | null
  last_activity: string | null
  pr_url: string | null
  stack_prs: unknown[] | null
  completion_message: string | null
}

export interface WorkItem {
  id: string
  source: string
  source_ref?: string
  title: string
  description: string
  priority: number
  status: WorkItemStatus
  blocked_by: string[]
  created_at: string
  activated_at: string | null
  completed_at: string | null
  environment: WorkItemEnvironment
  worker: WorkItemWorker
  plan: WorkItemPlan
  runtime: WorkItemRuntime
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
