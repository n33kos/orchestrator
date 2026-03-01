---
description: Activate a queued work item — create worktree, spawn session, start delegator
user_invocable: true
---

# Activate Work Stream

Activate a queued work item to create its worktree, spawn a Claude Code session, and optionally start a delegator.

## Process

1. If no item ID is provided, show the queue with `bash ~/orchestrator/scripts/status.sh` and ask which item to activate
2. Run the activation script:

```bash
bash ~/orchestrator/scripts/activate-stream.sh <item-id>
```

Options:
- Add `--quick` to skip dependency installation (faster, but may need manual setup)
- Add `--no-delegator` to skip delegator spawning

3. Report the result: worktree path, session ID, and whether a delegator was started
4. If activation fails due to concurrency limits, tell the user which items are active and ask if they want to pause one

## Important
- Respect the concurrency limit (default: 2 active projects)
- Quick fixes bypass the concurrency limit
- The item must have a branch name configured before activation
- If the branch name is empty, ask the user for one and update the item first
