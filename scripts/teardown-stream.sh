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

CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
REPO_PATH="$(grep 'path:' "$CONFIG" | head -1 | sed 's/.*: *//' | sed "s|~|$HOME|")"
ROSTRUM="$(grep 'rostrum:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
VMUX="$(grep 'vmux:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"

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

ITEM_BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['branch'])")"
ITEM_TITLE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")"
SESSION_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id', '') or '')")"
DELEGATOR_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('delegator_id', '') or '')")"

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
python3 -c "
import json
from datetime import datetime

with open('$QUEUE_FILE') as f:
    data = json.load(f)

for item in data['items']:
    if item['id'] == '$ITEM_ID':
        if item['status'] != 'completed':
            item['status'] = 'completed'
        item['completed_at'] = datetime.now().isoformat()
        item['session_id'] = None
        item['delegator_id'] = None
        item['worktree_path'] = None
        break

with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
echo "  Status: completed"

echo ""
echo "Teardown complete!"
echo "  Session killed, worktree removed, queue updated."
echo "  Branch '$ITEM_BRANCH' is preserved."
