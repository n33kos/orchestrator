# CLI Reference

Full command reference for worktree management and vmux (session manager). Load this file when you need detailed CLI options.

## Worktree Management

Worktree lifecycle commands are configured in `config/environment.yml` under the `worktree` section. Each command is a shell command template with variable interpolation:

| Variable | Description |
|----------|-------------|
| `{branch}` | The git branch name |
| `{path}` | The target worktree directory path |
| `{repo_path}` | The main repository path |

### Default Commands (plain git)

| Config Key | Default Command | Description |
|------------|----------------|-------------|
| `worktree.setup` | `git worktree add -b {branch} {path} main` | Create worktree with full setup |
| `worktree.setup_quick` | `git worktree add -b {branch} {path} main` | Create worktree, skip deps/build |
| `worktree.teardown` | `git worktree remove {path}` | Remove worktree and cleanup |
| `worktree.list` | `git worktree list --porcelain` | List active worktrees |
| `worktree.dev` | *(empty)* | Start dev server (optional) |

These can be overridden in `config/environment.local.yml` to use any worktree management tool.

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
