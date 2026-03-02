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
ITEM_JSON="$(python3 -c "
import json, sys
with open('$QUEUE_FILE') as f:
    data = json.load(f)
item = next((i for i in data['items'] if i['id'] == '$ITEM_ID'), None)
if not item:
    print('ERROR: Item $ITEM_ID not found', file=sys.stderr)
    sys.exit(1)
print(json.dumps(item))
")"

ITEM_TITLE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")"
SESSION_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id', '') or '')")"
DELEGATOR_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('delegator_id', '') or '')")"

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

# Update queue: move to review, clear session/delegator IDs but keep worktree_path
python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$ITEM_ID':
        item['status'] = '$TARGET_STATUS'
        item['session_id'] = None
        item['delegator_id'] = None
        # worktree_path is preserved so we can resume later
        break
with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

echo "  Status: $TARGET_STATUS (session + delegator killed, worktree preserved)"
emit_event "stream.suspended" "Suspended ($TARGET_STATUS): $ITEM_TITLE" --item-id "$ITEM_ID"
