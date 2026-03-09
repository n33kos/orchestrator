#!/usr/bin/env bash
# Suspend an active work stream: kill session + delegator but KEEP worktree.
# Used when moving a project to "review" — stops token burn while user reviews.
#
# Usage:
#   ./scripts/suspend-stream.sh <item-id> [--status <review>]

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

ITEM_ID="${1:?Usage: suspend-stream.sh <item-id> [--status <review>]}"
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
IFS=$'\x1f' read -r ITEM_TITLE SESSION_ID \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" title environment.session_id)

echo "Suspending: $ITEM_TITLE ($ITEM_ID)"

# NOTE: Delegator directory is preserved — only teardown-stream.sh deletes it.
# This allows delegator state history to survive suspend/review cycles.

# Kill worker session
if [[ -n "$SESSION_ID" ]]; then
    echo "  Killing worker session ($SESSION_ID)..."
    $VMUX kill "$SESSION_ID" 2>&1 || echo "  Session already stopped"
fi

# Update queue: move to target status, clear session_id but keep worktree_path
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" status="$TARGET_STATUS" environment.session_id=NULL

echo "  Status: $TARGET_STATUS (session + delegator killed, worktree + delegator dir preserved)"
emit_event "stream.suspended" "Suspended ($TARGET_STATUS): $ITEM_TITLE" --item-id "$ITEM_ID"
