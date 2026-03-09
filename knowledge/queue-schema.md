# Queue Schema Reference

Queue file: `~/.claude/orchestrator/queue.json`

## Top-Level Structure

```json
{
  "version": 1,
  "items": [...]
}
```

## Work Item Schema

```json
{
  "id": "ws-001",
  "source": "manual",
  "source_ref": "Dashboard — manual entry",
  "title": "Short description",
  "description": "Detailed description",
  "priority": 1,
  "status": "queued",
  "blocked_by": ["ws-000"],
  "created_at": "2026-03-09T12:00:00.000Z",
  "activated_at": null,
  "completed_at": null,
  "environment": {
    "repo": "/path/to/repo",
    "use_worktree": true,
    "branch": "feat/my-branch",
    "worktree_path": null,
    "session_id": null
  },
  "worker": {
    "commit_strategy": "branch_and_pr",
    "delegator_enabled": true,
    "stack_steps": []
  },
  "plan": {
    "file": "~/.claude/orchestrator/plans/ws-001.md",
    "summary": "Brief plan description",
    "approved": true,
    "approved_at": "2026-03-09T12:00:00.000Z"
  },
  "runtime": {
    "delegator_status": null,
    "spend": null,
    "last_activity": null,
    "pr_url": null,
    "stack_prs": null,
    "completion_message": null
  }
}
```

## Field Reference

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `ws-001`) |
| `source` | string | Origin of the item (`manual`, `github`, etc.) |
| `source_ref` | string | Human-readable source reference |
| `title` | string | Display name |
| `description` | string | Detailed description |
| `priority` | number | Priority (1 = highest) |
| `status` | string | `planning`, `queued`, `active`, `review`, `completed` |
| `blocked_by` | string[] | IDs of items that must complete first |
| `created_at` | ISO string | Creation timestamp |
| `activated_at` | ISO string \| null | When the item was activated |
| `completed_at` | ISO string \| null | When the item was completed |

### `environment` — Execution Environment

| Field | Type | Description |
|-------|------|-------------|
| `repo` | string \| null | Path to the target repository |
| `use_worktree` | boolean | Whether to create a git worktree (false = use repo directly) |
| `branch` | string \| null | Git branch name (or branch prefix for Graphite stacks) |
| `worktree_path` | string \| null | Path to the created worktree (set at activation) |
| `session_id` | string \| null | vmux session ID (set at activation) |

### `worker` — Worker Configuration

| Field | Type | Description |
|-------|------|-------------|
| `commit_strategy` | string | `branch_and_pr`, `graphite_stack`, or `commit_to_main` |
| `delegator_enabled` | boolean | Whether delegator monitoring is active |
| `stack_steps` | array \| null | Steps for Graphite stack items |

### `plan` — Implementation Plan

| Field | Type | Description |
|-------|------|-------------|
| `file` | string \| null | Path to the plan file |
| `summary` | string \| null | Brief plan description |
| `approved` | boolean | Whether the plan is user-approved |
| `approved_at` | ISO string \| null | When the plan was approved |

### `runtime` — Runtime State

| Field | Type | Description |
|-------|------|-------------|
| `delegator_status` | string \| null | Current delegator state |
| `spend` | object \| null | Token spend tracking data |
| `last_activity` | ISO string \| null | Last activity timestamp (stall detection) |
| `pr_url` | string \| null | Pull request URL |
| `stack_prs` | array \| null | PR URLs for Graphite stack items |
| `completion_message` | string \| null | Worker's completion summary |

## Status Transitions

```
planning → queued → active → review → completed
                                ↑        ↓
                                └────────┘ (re-queue)
```

Valid transitions:
- `planning` → `queued`, `active`
- `queued` → `planning`, `active`
- `active` → `review`, `completed`
- `review` → `active`, `completed`, `queued`
- `completed` → `queued`

## Commit Strategy Values

| Value | Description |
|-------|-------------|
| `branch_and_pr` | Standard workflow: create branch, open PR |
| `graphite_stack` | Graphite stacked PRs via `gt create` / `gt submit` |
| `commit_to_main` | Direct commits to main, no branch or PR |

## CLI Access

Queue fields use dotted path notation via `scripts/lib/queue.py`:

```bash
# Read a nested field
python3 -m lib.queue get <item-id> environment.branch

# Update a nested field
python3 -m lib.queue update <item-id> environment.session_id=<value>

# Set null
python3 -m lib.queue update <item-id> environment.session_id=NULL
```
