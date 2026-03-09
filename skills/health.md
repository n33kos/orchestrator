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
   - **Blocked items** — Items blocked by incomplete dependencies
   - **Concurrency issues** — More active projects than the limit allows

3. For each issue, suggest a fix:
   - Zombie: `vmux reconnect <path>` or auto-recover all
   - Stalled: Check on the worker, or move the stream to review
   - Blocked: Complete the blocking dependencies or remove them
   - Concurrency: Complete an active item or move one to review

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

## Debugging Sessions

When investigating why a session is stuck, idle, or misbehaving:

### Reading Session Logs

Use the transcript reader to understand what a session is doing:

```bash
# Full summary of recent activity
python3 ~/orchestrator/scripts/read-worker-transcript.py <worktree_path> --lines 500

# Quick idle check (returns IDLE:<reason> or ACTIVE)
python3 ~/orchestrator/scripts/read-worker-transcript.py <worktree_path> --format idle-check
```

Read the raw tmux pane to see what's currently on screen:

```bash
tmux capture-pane -t <tmux_session_name> -p -S -50
```

### Recovering Stuck Sessions

When a session is stuck (e.g., waiting for input, MCP disconnected, frozen):

| Action | Command |
|--------|---------|
| Interrupt current operation | `vmux interrupt <session-id>` |
| Ctrl-C + MCP reconnect + standby | `vmux hard-interrupt <session-id>` |
| MCP reconnect only | `vmux reconnect <path>` |
| Send text to session | `vmux send <session-id> "message"` |
| Send raw keystrokes via tmux | `tmux send-keys -t <tmux_session> "text" Enter` |
| Restart session completely | `vmux restart <session-id>` |

Always try `vmux hard-interrupt` first — it handles the most common stuck states (blocked on relay_standby, MCP disconnected, etc.).

### Recovering Zombie Sessions

When sessions lose their relay connection (e.g., after a daemon restart), they show as `[zombie]` in `vmux sessions`:

1. Run `vmux sessions` to identify zombie sessions
2. For each zombie, run `vmux reconnect <path>` using the session's `cwd` path
3. This triggers an MCP reconnect + re-enter standby inside the existing tmux session

To auto-recover all zombies: `bash ~/orchestrator/scripts/health-check.sh --auto-recover`
