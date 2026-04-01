#!/usr/bin/env bash
# Tear down an active work stream: kill session, remove worktree, update queue.
#
# Usage:
#   ./scripts/teardown-stream.sh <item-id> [--force]
#
# NOTE: Does NOT delete the git branch (per CLAUDE.md rules).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
VMUX="$CONFIG_TOOL_VMUX"
REPOSITORIES_JSON="$CONFIG_REPOSITORIES_JSON"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

# Helper: resolve per-repo config from REPOSITORIES_JSON
resolve_repo_config() {
    local repo_key="${1:-_defaults}"
    eval "$(python3 -c "
import json, os, sys
repos = json.loads(sys.argv[1])
key = sys.argv[2]
defaults = repos.get('_defaults', {})
repo = repos.get(key, defaults)
home = os.path.expanduser('~')
def e(v):
    return v.replace('~', home) if v else v
wt = repo.get('worktree', defaults.get('worktree', {}))
print(f\"REPO_PATH='{e(repo.get('path', ''))}'\" )
print(f\"WORKTREE_TEARDOWN_CMD='{wt.get('teardown', 'git worktree remove {path}')}'\" )
" "$REPOSITORIES_JSON" "$repo_key")"
}

# Helper: interpolate worktree command template variables
run_worktree_cmd() {
    local template="$1"
    local branch="${2:-}"
    local path="${3:-}"
    local cmd="$template"
    cmd="${cmd//\{branch\}/$branch}"
    cmd="${cmd//\{path\}/$path}"
    cmd="${cmd//\{repo_path\}/$REPO_PATH}"
    eval "$cmd"
}

ITEM_ID="${1:?Usage: teardown-stream.sh <item-id> [--force]}"
FORCE_FLAG=""

shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE_FLAG="--force" ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# Read item from queue
QUEUE_PY="python3 -m lib.queue"
IFS=$'\x1f' read -r ITEM_BRANCH ITEM_TITLE SESSION_ID WORKTREE_PATH REPO_KEY USE_WORKTREE \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" environment.branch title environment.session_id environment.worktree_path repo_key environment.use_worktree)

# Resolve per-repo config
[[ -z "$REPO_KEY" || "$REPO_KEY" == "None" ]] && REPO_KEY="_defaults"
resolve_repo_config "$REPO_KEY"

echo "Tearing down: $ITEM_TITLE ($ITEM_ID)"
echo "  Branch: $ITEM_BRANCH"

# Step 1: Clean up delegator
echo ""
echo "Step 1: Cleaning up delegator..."

# Clean up delegator status directory
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
if [[ -d "$DELEGATOR_DIR" ]]; then
    echo "  Cleaning up delegator status dir..."
    rm -rf "$DELEGATOR_DIR"
fi

# Step 2: Kill worker session
if [[ -n "$SESSION_ID" ]]; then
    echo ""
    echo "Step 2: Killing session ($SESSION_ID)..."
    $VMUX kill "$SESSION_ID" 2>&1 || echo "  Session already stopped"
else
    echo ""
    echo "Step 2: No session to kill"
fi

# Step 3: Remove worktree or workspace
# Determine mode: worktree items have use_worktree=true, workspace items have use_worktree=false
IS_WORKTREE="false"
if [[ "$USE_WORKTREE" == "true" || "$USE_WORKTREE" == "True" ]]; then
    IS_WORKTREE="true"
fi

if [[ "$IS_WORKTREE" == "true" && -n "$ITEM_BRANCH" ]]; then
    echo ""
    echo "Step 3: Removing worktree..."
    cd "$REPO_PATH"
    # Discover worktree path if not stored in queue
    if [[ -z "$WORKTREE_PATH" || "$WORKTREE_PATH" == "None" ]]; then
        WORKTREE_PATH="$(git worktree list --porcelain | awk -v branch="refs/heads/$ITEM_BRANCH" '
            /^worktree / { wt=substr($0, 10) }
            /^branch / && $2 == branch { print wt; exit }
        ')"
    fi
    if [[ -n "$WORKTREE_PATH" && "$WORKTREE_PATH" != "None" ]]; then
        run_worktree_cmd "$WORKTREE_TEARDOWN_CMD" "$ITEM_BRANCH" "$WORKTREE_PATH" 2>&1 || echo "  Worktree already removed or teardown failed"
    else
        echo "  No worktree path found, skipping removal"
    fi
    echo "  Branch '$ITEM_BRANCH' preserved (not deleted)"
else
    # Workspace mode: clean up the workspace directory
    WORKSPACE_DIR="$HOME/.claude/orchestrator/workspaces/$ITEM_ID"
    echo ""
    if [[ -d "$WORKSPACE_DIR" ]]; then
        echo "Step 3: Removing workspace directory ($WORKSPACE_DIR)..."
        rm -rf "$WORKSPACE_DIR"
    else
        echo "Step 3: No workspace to remove"
    fi
fi

# Step 4: Update queue item
echo ""
echo "Step 4: Updating queue..."
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" \
    status=completed completed_at=NOW environment.session_id=NULL environment.worktree_path=NULL
echo "  Status: completed"


echo ""
echo "Teardown complete!"
echo "  Session killed, worktree removed, queue updated."
echo "  Branch '$ITEM_BRANCH' is preserved."

emit_event "stream.completed" "Completed: $ITEM_TITLE" --item-id "$ITEM_ID"
