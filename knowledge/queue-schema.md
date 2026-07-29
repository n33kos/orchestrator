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
  "priority": 1,
  "status": "queued",
  "blocked_by": ["ws-000", "FPLAT-123"],
  "created_at": "2026-03-09T12:00:00.000Z",
  "integration": {
    "adapter": "fplat-linear",
    "provider": "linear",
    "issue_id": "02e227c8-9e7c-4c17-bf90-2f8329eedfcb",
    "identifier": "FPLAT-123",
    "url": "https://linear.app/org/issue/FPLAT-123/slug",
    "context_file": "~/.claude/orchestrator/context/ws-001.md",
    "blocked_by_refs": ["FPLAT-122"],
    "announced_at": null,
    "synced_status": null,
    "synced_at": null
  },
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
| `priority` | number | Priority (1 = highest) |
| `status` | string | `planning`, `queued`, `active`, `review`, `completed`, `cancelled` |
| `blocked_by` | string[] | Items that must complete first. A queue id, or a source-tracker identifier when the blocker has not been imported. An unrecognized entry counts as unsatisfied, so it blocks. |
| `created_at` | ISO string | Creation timestamp |
| `activated_at` | ISO string \| null | When the item was activated |
| `completed_at` | ISO string \| null | When the item was completed |

### `integration` — Source Issue Link

Present only on items created by work discovery. Absent for hand-entered items.

| Field | Type | Description |
|-------|------|-------------|
| `adapter` | string | Name of the adapter that discovered the item |
| `provider` | string | Adapter type (`linear`, `github`, `jira`, `markdown`) |
| `issue_id` | string \| null | Provider's internal issue id, used for writeback |
| `identifier` | string \| null | Human identifier, e.g. `FPLAT-123` |
| `url` | string \| null | Link to the source issue |
| `context_file` | string \| null | Imported body and discussion, read by plan generation |
| `blocked_by_refs` | string[] | Source identifiers of the issues blocking this one |
| `announced_at` | ISO string \| null | When the orchestrator commented on the source issue |
| `synced_status` | string \| null | Last status pushed back to the source issue |
| `synced_at` | ISO string \| null | When that status was pushed |

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

Items are created in `planning` with no plan. Completing the plan is what promotes an
item to `queued`, where it waits for approval and an open concurrency slot.

Valid transitions, as enforced by `dashboard/src/utils/status-transitions.ts`:

- `planning` → `active`, `queued`, `cancelled`
- `queued` → `planning`, `active`, `cancelled`
- `active` → `review`, `completed`, `cancelled`
- `review` → `active`, `completed`, `queued`, `cancelled`
- `completed` → `queued`
- `cancelled` → `queued`

## Commit Strategy Values

| Value | Description |
|-------|-------------|
| `branch_and_pr` | Standard workflow: create branch, open PR |
| `graphite_stack` | Graphite stacked PRs via `gt create` / `gt submit` |
| `commit_to_main` | Direct commits to main, no branch or PR |

## Creating Items

Use `scripts/add-work.py` rather than writing to the queue file directly. It allocates
the id from the shared counter and writes through the locking, schema-validating
helper. Because validation runs across every item on write, a single malformed item
blocks all later writes, including the scheduler's.

There is no `description` field. Ticket content belongs in the plan file referenced by
`plan.file`.

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
