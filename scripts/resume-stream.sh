#!/usr/bin/env bash
# Resume a suspended (review/paused) work stream: respawn session + delegator.
# The worktree should still exist from the prior activation.
#
# Usage:
#   ./scripts/resume-stream.sh <item-id> [--no-delegator]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
VMUX="$CONFIG_TOOL_VMUX"
REPO_PATH="$CONFIG_REPO_PATH"
ROSTRUM="$CONFIG_TOOL_ROSTRUM"
WORKTREE_PREFIX="$CONFIG_WORKTREE_PREFIX"
MAX_ACTIVE="$CONFIG_MAX_ACTIVE_PROJECTS"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

ITEM_ID="${1:?Usage: resume-stream.sh <item-id> [--no-delegator]}"
NO_DELEGATOR=false

shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-delegator) NO_DELEGATOR=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
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
if item['status'] not in ('review', 'paused'):
    print(f'ERROR: Item $ITEM_ID is {item[\"status\"]}, expected review or paused', file=sys.stderr)
    sys.exit(1)
print(json.dumps(item))
")"

ITEM_TITLE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")"
ITEM_BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['branch'])")"
ITEM_TYPE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['type'])")"
WORKTREE_PATH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('worktree_path', '') or '')")"
DELEGATOR_ENABLED="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('delegator_enabled', True))")"

echo "Resuming: $ITEM_TITLE ($ITEM_ID)"

# Check concurrency
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

# Ensure worktree exists (it should, but be safe)
if [[ -z "$WORKTREE_PATH" ]]; then
    WORKTREE_PATH="${WORKTREE_PREFIX}${ITEM_BRANCH}"
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
    echo "  Worktree missing — recreating..."
    cd "$REPO_PATH"
    $ROSTRUM setup "$ITEM_BRANCH" --quick
fi

# Spawn worker session
echo "  Spawning worker session..."
$VMUX spawn "$WORKTREE_PATH" 2>&1 || true

SESSION_ID="$(python3 -c "
import hashlib
cwd = '$WORKTREE_PATH'
print(hashlib.sha256(cwd.encode()).hexdigest()[:12])
")"

# Update queue: move to active, set session ID
python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$ITEM_ID':
        item['status'] = 'active'
        item['session_id'] = '$SESSION_ID'
        item['worktree_path'] = '$WORKTREE_PATH'
        break
with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

echo "  Status: active (session: $SESSION_ID)"

# Optionally spawn delegator
if [[ "$ITEM_TYPE" == "project" && "$NO_DELEGATOR" == "false" && "$DELEGATOR_ENABLED" == "True" ]]; then
    echo "  Spawning delegator..."
    "$SCRIPT_DIR/spawn-delegator.sh" "$ITEM_ID" || {
        echo "  WARNING: Failed to spawn delegator" >&2
    }
fi

echo ""
echo "Resume complete!"
emit_event "stream.resumed" "Resumed from review: $ITEM_TITLE" --item-id "$ITEM_ID" --session-id "$SESSION_ID"
