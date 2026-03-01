#!/usr/bin/env bash
# Activate a queued work item: create worktree, spawn session, optionally spawn delegator.
#
# Usage:
#   ./scripts/activate-stream.sh <item-id> [--quick] [--no-delegator]
#
# Reads config from config/environment.yml and queue from ~/.claude/orchestrator/queue.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse config (lightweight YAML parsing via grep/sed)
CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
REPO_PATH="$(grep 'path:' "$CONFIG" | head -1 | sed 's/.*: *//' | sed "s|~|$HOME|")"
WORKTREE_PREFIX="$(grep 'worktree_prefix:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
ROSTRUM="$(grep 'rostrum:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
VMUX="$(grep 'vmux:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
MAX_ACTIVE="$(grep 'max_active_projects:' "$CONFIG" | sed 's/.*: *//')"
DELEGATOR_DEFAULT="$(grep 'enabled_by_default:' "$CONFIG" | sed 's/.*: *//')"

# Arguments
ITEM_ID="${1:?Usage: activate-stream.sh <item-id> [--quick] [--no-delegator]}"
QUICK_FLAG=""
NO_DELEGATOR=false

shift
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick) QUICK_FLAG="--quick" ;;
        --no-delegator) NO_DELEGATOR=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# Read queue and find item
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

ITEM_STATUS="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")"
ITEM_TYPE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['type'])")"
ITEM_BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['branch'])")"
ITEM_TITLE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")"
DELEGATOR_ENABLED="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('delegator_enabled', True))")"

# Validate status
if [[ "$ITEM_STATUS" != "queued" && "$ITEM_STATUS" != "planning" ]]; then
    echo "ERROR: Item $ITEM_ID is '$ITEM_STATUS', expected 'queued' or 'planning'" >&2
    exit 1
fi

# Check concurrency for projects
if [[ "$ITEM_TYPE" == "project" ]]; then
    ACTIVE_COUNT="$(python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
count = sum(1 for i in data['items'] if i['status'] == 'active' and i['type'] == 'project')
print(count)
")"
    if [[ "$ACTIVE_COUNT" -ge "$MAX_ACTIVE" ]]; then
        echo "ERROR: Concurrency limit reached ($ACTIVE_COUNT/$MAX_ACTIVE active projects)" >&2
        exit 1
    fi
fi

# Validate branch name
if [[ -z "$ITEM_BRANCH" ]]; then
    echo "ERROR: Item $ITEM_ID has no branch name configured" >&2
    exit 1
fi

echo "Activating: $ITEM_TITLE ($ITEM_ID)"
echo "  Type: $ITEM_TYPE"
echo "  Branch: $ITEM_BRANCH"

# Step 1: Create worktree
WORKTREE_PATH="${WORKTREE_PREFIX}${ITEM_BRANCH}"
echo ""
echo "Step 1: Creating worktree..."
cd "$REPO_PATH"
if [[ -d "$WORKTREE_PATH" ]]; then
    echo "  Worktree already exists at $WORKTREE_PATH"
else
    $ROSTRUM setup "$ITEM_BRANCH" $QUICK_FLAG
    echo "  Created: $WORKTREE_PATH"
fi

# Step 2: Spawn worker session
echo ""
echo "Step 2: Spawning worker session..."
SESSION_OUTPUT="$($VMUX spawn "$WORKTREE_PATH" 2>&1)" || true
echo "  $SESSION_OUTPUT"

# Get the session ID (deterministic from path)
SESSION_ID="$(python3 -c "
import hashlib
cwd = '$WORKTREE_PATH'
print(hashlib.sha256(cwd.encode()).hexdigest()[:12])
")"

# Step 3: Update queue item status
echo ""
echo "Step 3: Updating queue..."
python3 -c "
import json
from datetime import datetime

with open('$QUEUE_FILE') as f:
    data = json.load(f)

for item in data['items']:
    if item['id'] == '$ITEM_ID':
        item['status'] = 'active'
        item['activated_at'] = datetime.now().isoformat()
        item['worktree_path'] = '$WORKTREE_PATH'
        item['session_id'] = '$SESSION_ID'
        break

with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
echo "  Status: active"
echo "  Session ID: $SESSION_ID"

# Step 4: Optionally spawn delegator
if [[ "$ITEM_TYPE" == "project" && "$NO_DELEGATOR" == "false" && "$DELEGATOR_ENABLED" == "True" ]]; then
    echo ""
    echo "Step 4: Spawning delegator..."
    "$SCRIPT_DIR/spawn-delegator.sh" "$ITEM_ID" || {
        echo "  WARNING: Failed to spawn delegator — worker will run without oversight" >&2
    }
else
    echo ""
    echo "Step 4: Delegator skipped (type=$ITEM_TYPE, no_delegator=$NO_DELEGATOR, enabled=$DELEGATOR_ENABLED)"
fi

echo ""
echo "Activation complete!"
echo "  Worktree: $WORKTREE_PATH"
echo "  Session: $SESSION_ID"
echo "  Status: active"
