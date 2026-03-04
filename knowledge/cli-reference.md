# CLI Reference

Full command reference for Rostrum (worktree manager) and vmux (session manager). Load this file when you need detailed CLI options.

## Worktree Manager (Rostrum)

| Command | Description |
|---------|-------------|
| `rostrum setup BRANCH` | Create worktree with full env setup |
| `rostrum setup BRANCH --quick` | Create worktree, skip deps/build |
| `rostrum setup BRANCH --open` | Create and open in editor |
| `rostrum teardown BRANCH` | Remove worktree and cleanup |
| `rostrum teardown BRANCH --delete-branch` | Also delete the git branch |
| `rostrum teardown BRANCH --force` | Force removal with uncommitted changes |
| `rostrum list` | List active worktrees |
| `rostrum list --verbose` | List with URLs and details |
| `rostrum dev` | Start webpack dev server (run from worktree dir) |
| `rostrum open BRANCH` | Open worktree in editor |

## Session Manager (vmux)

| Command | Description |
|---------|-------------|
| `vmux spawn <path>` | Spawn new Claude session in directory |
| `vmux kill <session-id>` | Kill a session |
| `vmux sessions` | List all sessions |
| `vmux status` | Full service + session status |
| `vmux restart <session-id>` | Kill and respawn a session |
| `vmux attach <session-id>` | Attach to session's tmux terminal |
| `vmux reconnect <path>` | Re-enter standby for a session |
| `vmux interrupt <session-id>` | Send Ctrl-C to a session |
| `vmux hard-interrupt <session-id>` | Ctrl-C + MCP reconnect + re-enter standby |
| `vmux send <session-id> "msg"` | Send message to a session (shows in web transcript) |
