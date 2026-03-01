---
description: Show orchestrator status — queue, sessions, worktrees, and next-up items
user_invocable: true
---

# Orchestrator Status

Run the status script to get a comprehensive overview of the orchestrator state.

```bash
bash ~/orchestrator/scripts/status.sh
```

Present the output in a clear, organized summary:
1. **Queue Summary** — Active, queued, paused, blocked, and completed counts
2. **Active Work Streams** — What's currently running, with session and delegator status
3. **Next Up** — Highest priority queued items ready for activation
4. **Issues** — Any blocked items, zombie sessions, or stalled streams

If there are issues, suggest actions (e.g., "Recover zombie sessions", "Resolve blocker on X").
