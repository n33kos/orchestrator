#!/usr/bin/env bash
# Initialize a delegator state file for a work stream.
#
# In the one-shot model, delegators are not persistent sessions — they are
# stateless Claude invocations driven by the scheduler. This script creates
# the delegator directory and initializes state.json with the new format.
#
# Usage:
#   ./scripts/spawn-delegator.sh <item-id>
#
# Prerequisites:
#   - Work item must be active with a session_id

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
DASHBOARD_PORT="$CONFIG_API_PORT"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

QUEUE_PY="python3 -m lib.queue"

ITEM_ID="${1:?Usage: spawn-delegator.sh <item-id>}"

# Read item from queue (full JSON for validation, then extract fields)
ITEM_JSON="$(cd "$SCRIPT_DIR" && $QUEUE_PY get-item "$ITEM_ID")"

# Validate item state
ITEM_STATUS="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")"
ITEM_SESSION="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))")"
if [[ "$ITEM_STATUS" != "active" ]]; then
    echo "ERROR: Item $ITEM_ID is $ITEM_STATUS, expected active" >&2
    exit 1
fi
if [[ -z "$ITEM_SESSION" ]]; then
    echo "ERROR: Item $ITEM_ID has no worker session" >&2
    exit 1
fi

# Extract fields
IFS=$'\t' read -r WORKER_SESSION_ID WORKTREE_PATH ITEM_TITLE ITEM_BRANCH \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" session_id worktree_path title branch)

echo "Initializing delegator for: $ITEM_TITLE ($ITEM_ID)"
echo "  Worker session: $WORKER_SESSION_ID"
echo "  Worktree: $WORKTREE_PATH"

# Create the delegator directory
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
mkdir -p "$DELEGATOR_DIR"

# Initialize state.json with the new format
python3 -c "
import json
from datetime import datetime, timezone

state = {
    'item_id': '$ITEM_ID',
    'worker_session_id': '$WORKER_SESSION_ID',
    'worktree_path': '$WORKTREE_PATH',
    'branch': '$ITEM_BRANCH',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'cycle_count': 0,
    'last_cycle_at': None,

    'commits': {
        'last_seen_hash': None,
        'total_reviewed': 0,
        'reviews': [],
    },

    'pr': {
        'url': None,
        'number': None,
        'ci_status': None,
        'review_completed': False,
        'review_assessment': None,
        'review_comments': [],
    },

    'worker_state': {
        'last_known_activity': None,
        'idle_since': None,
        'consecutive_idle_cycles': 0,
        'messages_sent': [],
        'last_message_cycle': None,
    },

    'flags': {
        'stall_detected': False,
        'stall_since': None,
        'worker_lost': False,
        'awaiting_ci': False,
        'ready_for_review': False,
    },

    'cycle_log': [],

    'health': {
        'status': 'healthy',
        'last_cycle_at': None,
        'last_successful_cycle_at': None,
        'consecutive_errors': 0,
        'last_error': None,
    },
}

with open('$DELEGATOR_DIR/state.json', 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
"

# Update queue item metadata
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" \
    metadata.delegator_status=initializing

echo ""
echo "Delegator initialized!"
echo "  Delegator dir: $DELEGATOR_DIR"
echo "  State file: $DELEGATOR_DIR/state.json"
echo "  Monitoring worker: $WORKER_SESSION_ID"

emit_event "delegator.initialized" "Delegator initialized for $ITEM_ID" --item-id "$ITEM_ID"
