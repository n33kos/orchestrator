#!/usr/bin/env bash
# Report work item completion — callable by worker sessions or delegators.
#
# Usage:
#   ./scripts/worker-complete.sh <item-id> [--status <completed|review>] [--message "..."] [--pr-url "..."] [--teardown]
#
# This script updates the queue directly (no HTTP dependency) and emits an event.
# Workers can call this when they finish their task.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

ITEM_ID="${1:?Usage: worker-complete.sh <item-id> [--status <completed|review>] [--message \"...\"] [--pr-url \"...\"] [--teardown]}"
shift

TARGET_STATUS="completed"
MESSAGE=""
PR_URL=""
TEARDOWN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --status) TARGET_STATUS="$2"; shift 2 ;;
        --message) MESSAGE="$2"; shift 2 ;;
        --pr-url) PR_URL="$2"; shift 2 ;;
        --teardown) TEARDOWN=true; shift ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

if [[ "$TARGET_STATUS" != "completed" && "$TARGET_STATUS" != "review" ]]; then
    echo "ERROR: status must be 'completed' or 'review'" >&2
    exit 1
fi

# Update queue
PREV_STATUS="$(python3 -c "
import json, sys
from datetime import datetime

with open('$QUEUE_FILE') as f:
    data = json.load(f)

item = next((i for i in data['items'] if i['id'] == '$ITEM_ID'), None)
if not item:
    print('ERROR: Item $ITEM_ID not found', file=sys.stderr)
    sys.exit(1)

prev = item['status']
item['status'] = '$TARGET_STATUS'

if '$TARGET_STATUS' == 'completed':
    item['completed_at'] = datetime.now().isoformat()

pr_url = '''$PR_URL'''
if pr_url:
    item['pr_url'] = pr_url

message = '''$MESSAGE'''
if message:
    if 'metadata' not in item or item['metadata'] is None:
        item['metadata'] = {}
    item['metadata']['completion_message'] = message

with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print(prev)
")"

echo "Worker completion reported:"
echo "  Item: $ITEM_ID"
echo "  Previous status: $PREV_STATUS"
echo "  New status: $TARGET_STATUS"
[[ -n "$MESSAGE" ]] && echo "  Message: $MESSAGE"
[[ -n "$PR_URL" ]] && echo "  PR URL: $PR_URL"

EVENT_TYPE="worker.completed"
[[ "$TARGET_STATUS" == "review" ]] && EVENT_TYPE="worker.review"

emit_event "$EVENT_TYPE" "${MESSAGE:-Worker reported $TARGET_STATUS for $ITEM_ID}" --item-id "$ITEM_ID"

# Optionally trigger full teardown
if [[ "$TEARDOWN" == "true" && "$TARGET_STATUS" == "completed" ]]; then
    echo ""
    echo "Triggering teardown..."
    "$SCRIPT_DIR/teardown-stream.sh" "$ITEM_ID" 2>&1 | sed 's/^/  /'
fi
