---
description: Tear down a work stream — kill session, remove worktree, preserve branch
user_invocable: true
---

# Tear Down Work Stream

Tear down an active work stream: kill the session, remove the worktree, and mark the item as completed. The git branch is always preserved.

## Process

1. If no item ID is provided, show active items with `bash ~/orchestrator/scripts/status.sh` and ask which to tear down
2. Confirm with the user before proceeding (unless explicitly told to skip confirmation)
3. Run the teardown script:

```bash
bash ~/orchestrator/scripts/teardown-stream.sh <item-id>
```

Add `--force` if the worktree has uncommitted changes and the user confirms they want to discard them.

4. Report the result: what was cleaned up and that the branch was preserved

## Important
- NEVER delete git branches — the `--delete-branch` flag must never be used
- Always confirm before tearing down unless the user said to skip confirmation
- If the item has a delegator, the delegator will be killed first
- The item status will be set to "completed"
