#!/usr/bin/env bash
# Suspend an active work stream: kill session + delegator but KEEP worktree.
# Used when moving a project to "review" — stops token burn while user reviews.
#
# Usage:
#   ./scripts/suspend-stream.sh <item-id> [--status <review|paused>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
VMUX="$CONFIG_TOOL_VMUX"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

ITEM_ID="${1:?Usage: suspend-stream.sh <item-id> [--status <review|paused>]}"
shift
TARGET_STATUS="review"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --status) TARGET_STATUS="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Read item
QUEUE_PY="python3 -m lib.queue"
IFS=$'\x1f' read -r ITEM_TITLE SESSION_ID DELEGATOR_ID \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" title session_id delegator_id)

echo "Suspending: $ITEM_TITLE ($ITEM_ID)"

# Kill delegator if running
if [[ -n "$DELEGATOR_ID" ]]; then
    echo "  Killing delegator ($DELEGATOR_ID)..."
    $VMUX kill "$DELEGATOR_ID" 2>&1 || echo "  Delegator already stopped"
fi

# Clean up delegator status directory
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
if [[ -d "$DELEGATOR_DIR" ]]; then
    echo "  Cleaning up delegator status dir..."
    rm -rf "$DELEGATOR_DIR"
fi

# Kill worker session
if [[ -n "$SESSION_ID" ]]; then
    echo "  Killing worker session ($SESSION_ID)..."
    $VMUX kill "$SESSION_ID" 2>&1 || echo "  Session already stopped"
fi

# Update queue: move to target status, clear session/delegator IDs but keep worktree_path
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" status="$TARGET_STATUS" session_id=NULL delegator_id=NULL

echo "  Status: $TARGET_STATUS (session + delegator killed, worktree preserved)"
emit_event "stream.suspended" "Suspended ($TARGET_STATUS): $ITEM_TITLE" --item-id "$ITEM_ID"
