---
description: Run health check — detect zombie sessions, stalled streams, and issues
user_invocable: true
---

# Health Check

Run a health check on the orchestrator to detect issues.

## Process

1. Run the health check:

```bash
bash ~/orchestrator/scripts/health-check.sh
```

2. Report findings:
   - **Zombie sessions** — Sessions that lost their relay connection
   - **Stalled streams** — Active items with no commits for 24+ hours
   - **Blocked items** — Items with unresolved blockers
   - **Concurrency issues** — More active projects than the limit allows

3. For each issue, suggest a fix:
   - Zombie: `vmux reconnect <path>` or auto-recover all
   - Stalled: Check on the worker, or pause the stream
   - Blocked: Review and resolve blockers
   - Concurrency: Pause or complete an active item

4. If the user wants to auto-recover zombies:

```bash
# For each zombie session
vmux reconnect <path>
```

## Quick Fix

To auto-recover all zombie sessions at once:

```bash
bash ~/orchestrator/scripts/health-check.sh --auto-recover
```
