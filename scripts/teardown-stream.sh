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
ROSTRUM="$CONFIG_TOOL_ROSTRUM"
VMUX="$CONFIG_TOOL_VMUX"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

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
IFS=$'\t' read -r ITEM_BRANCH ITEM_TITLE SESSION_ID DELEGATOR_ID \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" branch title session_id delegator_id)

echo "Tearing down: $ITEM_TITLE ($ITEM_ID)"
echo "  Branch: $ITEM_BRANCH"

# Step 1: Kill delegator if running
if [[ -n "$DELEGATOR_ID" ]]; then
    echo ""
    echo "Step 1: Killing delegator ($DELEGATOR_ID)..."
    $VMUX kill "$DELEGATOR_ID" 2>&1 || echo "  Delegator already stopped"
else
    echo ""
    echo "Step 1: No delegator to kill"
fi

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
    $ROSTRUM teardown "$ITEM_BRANCH" $FORCE_FLAG 2>&1 || echo "  Worktree already removed or teardown failed"
    echo "  Branch '$ITEM_BRANCH' preserved (not deleted)"
else
    echo ""
    echo "Step 3: No branch configured, skipping worktree removal"
fi

# Step 4: Update queue item
echo ""
echo "Step 4: Updating queue..."
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" \
    status=completed completed_at=NOW session_id=NULL delegator_id=NULL worktree_path=NULL
echo "  Status: completed"

# Step 5: Auto-train profile from the session transcript
echo ""
echo "Step 5: Training profile from session..."
TRAINING_MODE="$CONFIG_DELEGATOR_TRAINING_MODE"
if [[ "$TRAINING_MODE" == "true" && -n "$SESSION_ID" ]]; then
    # Find the most recent JSONL transcript matching this session's cwd
    TRANSCRIPT="$(python3 -c "
import os, sys
from pathlib import Path
projects_dir = Path.home() / '.claude' / 'projects'
best = None
best_mtime = 0
for d in projects_dir.iterdir():
    if not d.is_dir():
        continue
    for f in d.iterdir():
        if f.suffix == '.jsonl' and f.stat().st_size > 10000:
            mt = f.stat().st_mtime
            if mt > best_mtime:
                best_mtime = mt
                best = str(f)
if best:
    print(best)
" 2>/dev/null)" || true
    if [[ -n "$TRANSCRIPT" ]]; then
        python3 "$SCRIPT_DIR/train-profile.py" "$TRANSCRIPT" --last-n 50 2>&1 | sed 's/^/  /' || echo "  Training skipped (error)"
    else
        echo "  No session transcript found"
    fi
else
    echo "  Training disabled or no session to train from"
fi

echo ""
echo "Teardown complete!"
echo "  Session killed, worktree removed, queue updated."
echo "  Branch '$ITEM_BRANCH' is preserved."

emit_event "stream.completed" "Completed: $ITEM_TITLE" --item-id "$ITEM_ID"
