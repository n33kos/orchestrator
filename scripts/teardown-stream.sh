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
REPO_PATH="$CONFIG_REPO_PATH"
VMUX="$CONFIG_TOOL_VMUX"
WORKTREE_TEARDOWN_CMD="$CONFIG_WORKTREE_TEARDOWN"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

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
IFS=$'\x1f' read -r ITEM_BRANCH ITEM_TITLE SESSION_ID WORKTREE_PATH \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" environment.branch title environment.session_id environment.worktree_path)

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

# Step 3: Remove worktree (never delete the branch)
if [[ -n "$ITEM_BRANCH" ]]; then
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
    echo ""
    echo "Step 3: No branch configured, skipping worktree removal"
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
