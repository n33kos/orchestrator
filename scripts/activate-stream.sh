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

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
REPO_PATH="$CONFIG_REPO_PATH"
WORKTREE_PREFIX="$CONFIG_WORKTREE_PREFIX"
ROSTRUM="$CONFIG_TOOL_ROSTRUM"
VMUX="$CONFIG_TOOL_VMUX"
MAX_ACTIVE="$CONFIG_MAX_ACTIVE_PROJECTS"
DELEGATOR_DEFAULT="$CONFIG_DELEGATOR_ENABLED"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

# Pre-flight checks
if [[ ! -x "$VMUX" ]]; then
    echo "ERROR: vmux not found or not executable at $VMUX" >&2
    echo "  Install vmux or update config/environment.yml" >&2
    exit 1
fi
if [[ ! -d "$REPO_PATH" ]]; then
    echo "ERROR: Main repo not found at $REPO_PATH" >&2
    exit 1
fi
if ! "$VMUX" status &>/dev/null; then
    echo "ERROR: vmux daemon not running — start with: vmux start" >&2
    exit 1
fi

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
DELEGATOR_ENABLED="$(echo "$ITEM_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin).get('delegator_enabled'); print(d if d is not None else '$DELEGATOR_DEFAULT')")"
CUSTOM_REPO="$(echo "$ITEM_JSON" | python3 -c "import json,sys; m=json.load(sys.stdin).get('metadata',{}); print(m.get('repo_path',''))" | sed "s|~|$HOME|")"
LOCAL_DIR="$(echo "$ITEM_JSON" | python3 -c "import json,sys; m=json.load(sys.stdin).get('metadata',{}); print(m.get('local_directory',''))" | sed "s|~|$HOME|")"

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

# Local directory items: no worktree, just spawn session in the directory
if [[ -n "$LOCAL_DIR" ]]; then
    echo "Activating: $ITEM_TITLE ($ITEM_ID)"
    echo "  Type: $ITEM_TYPE (local directory)"
    echo "  Directory: $LOCAL_DIR"
    echo ""
    echo "Step 1: Preparing local directory..."
    if [[ ! -d "$LOCAL_DIR" ]]; then
        mkdir -p "$LOCAL_DIR"
        echo "  Created: $LOCAL_DIR"
    else
        echo "  Already exists: $LOCAL_DIR"
    fi
    WORKTREE_PATH="$LOCAL_DIR"
# Cross-repo items use the custom repo path directly (no worktree)
elif [[ -n "$CUSTOM_REPO" ]]; then
    if [[ ! -d "$CUSTOM_REPO" ]]; then
        echo "ERROR: Custom repo path does not exist: $CUSTOM_REPO" >&2
        exit 1
    fi
    WORKTREE_PATH="$CUSTOM_REPO"
    echo "Activating: $ITEM_TITLE ($ITEM_ID)"
    echo "  Type: $ITEM_TYPE (cross-repo)"
    echo "  Repo: $CUSTOM_REPO"
    echo ""
    echo "Step 1: Using existing repo (no worktree needed)"
    echo "  Path: $WORKTREE_PATH"
else
    # Standard flow: validate branch and create worktree via Rostrum
    if [[ -z "$ITEM_BRANCH" ]]; then
        echo "ERROR: Item $ITEM_ID has no branch name configured" >&2
        exit 1
    fi

    echo "Activating: $ITEM_TITLE ($ITEM_ID)"
    echo "  Type: $ITEM_TYPE"
    echo "  Branch: $ITEM_BRANCH"

    # Step 1: Create worktree
    # Use existing worktree_path from queue item if available, otherwise compute from prefix
    EXISTING_WORKTREE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('worktree_path',''))")"
    if [[ -n "$EXISTING_WORKTREE" && -d "$EXISTING_WORKTREE" ]]; then
        WORKTREE_PATH="$EXISTING_WORKTREE"
    else
        WORKTREE_PATH="${WORKTREE_PREFIX}${ITEM_BRANCH}"
    fi
    echo ""
    echo "Step 1: Creating worktree..."
    cd "$REPO_PATH"
    # Find existing worktree by branch name (reliable even with hashed paths)
    find_worktree_by_branch() {
        git worktree list --porcelain | awk -v branch="refs/heads/$1" '
            /^worktree / { wt=substr($0, 10) }
            /^branch / && $2 == branch { print wt; exit }
        '
    }
    EXISTING_GIT_WORKTREE="$(find_worktree_by_branch "$ITEM_BRANCH")"
    if [[ -n "$EXISTING_GIT_WORKTREE" && -d "$EXISTING_GIT_WORKTREE" ]]; then
        WORKTREE_PATH="$EXISTING_GIT_WORKTREE"
        echo "  Worktree already exists at $WORKTREE_PATH"
    elif [[ -d "$WORKTREE_PATH" ]]; then
        echo "  Worktree already exists at $WORKTREE_PATH"
    else
        if $ROSTRUM setup "$ITEM_BRANCH" $QUICK_FLAG; then
            ACTUAL_WORKTREE="$(find_worktree_by_branch "$ITEM_BRANCH")"
            if [[ -n "$ACTUAL_WORKTREE" && -d "$ACTUAL_WORKTREE" ]]; then
                WORKTREE_PATH="$ACTUAL_WORKTREE"
            fi
            echo "  Created: $WORKTREE_PATH"
        else
            ACTUAL_WORKTREE="$(find_worktree_by_branch "$ITEM_BRANCH")"
            if [[ -n "$ACTUAL_WORKTREE" && -d "$ACTUAL_WORKTREE" ]]; then
                WORKTREE_PATH="$ACTUAL_WORKTREE"
                echo "  Rostrum failed but worktree exists at $WORKTREE_PATH"
            else
                echo "  ERROR: Rostrum setup failed and no existing worktree found" >&2
                exit 1
            fi
        fi
    fi
fi

# Step 2: Spawn worker session
echo ""
echo "Step 2: Spawning worker session..."
# Generate a short display name from the item ID and title
SESSION_NAME="$(python3 -c "
title = '''$ITEM_TITLE'''
item_id = '$ITEM_ID'
# Truncate title to first 3 meaningful words
words = [w for w in title.split() if len(w) > 2][:3]
short = '-'.join(w.lower() for w in words) if words else 'worker'
# Sanitize for tmux: alphanumeric, dash, underscore only
import re
short = re.sub(r'[^a-z0-9_-]', '', short)[:20]
print(f'{item_id}-{short}')
")"
SESSION_OUTPUT="$($VMUX spawn "$WORKTREE_PATH" --name "$SESSION_NAME" 2>&1)" || true
echo "  $SESSION_OUTPUT"

# Get session ID from vmux sessions (preferred) or compute from path (fallback)
SESSION_ID=""
for attempt in 1 2 3; do
    SESSION_ID="$($VMUX sessions 2>/dev/null | python3 -c "
import sys
lines = sys.stdin.read().strip().split('\n')
current_id = None
for line in lines:
    line = line.strip()
    if line.startswith('[') and ']' in line:
        current_id = line.split(']')[1].strip()
    elif 'cwd:' in line and '$WORKTREE_PATH' in line and current_id:
        print(current_id)
        break
" 2>/dev/null)"
    if [[ -n "$SESSION_ID" ]]; then
        break
    fi
    sleep 2
done

# Fallback: compute from path hash
if [[ -z "$SESSION_ID" ]]; then
    SESSION_ID="$(python3 -c "
import hashlib
cwd = '$WORKTREE_PATH'
print(hashlib.sha256(cwd.encode()).hexdigest()[:12])
")"
    echo "  WARNING: Could not find session in vmux — using computed ID $SESSION_ID" >&2
fi

# Step 2b: Send task reference to the worker session
echo ""
echo "Step 2b: Sending task instructions to worker..."
# Wait for session to enter standby (give it time to initialize)
sleep 5

# Build a concise task message that references the plan file
PLAN_FILE="$(echo "$ITEM_JSON" | python3 -c "
import json, sys, os
item = json.load(sys.stdin)
meta = item.get('metadata', {}) or {}
plan_file = meta.get('plan_file', '')
if plan_file:
    print(os.path.expanduser(plan_file))
")"

TASK_MESSAGE="[Task Assignment] $ITEM_TITLE

Read your full implementation plan and task context at: $PLAN_FILE

Branch: $ITEM_BRANCH
Status: Activating now — follow the plan steps in order."

if $VMUX send "$SESSION_ID" "$TASK_MESSAGE" 2>/dev/null; then
    echo "  Task instructions sent to worker"
else
    echo "  WARNING: Could not send task instructions (worker may not be in standby yet)" >&2
fi

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

# Set deterministic hue for this work item (worker + delegator will share it)
ITEM_HUE="$(python3 -c "
import hashlib
h = int(hashlib.md5('$ITEM_ID'.encode()).hexdigest()[:4], 16) % 360
print(h)
")"
RELAY_SECRET="$(cat "$HOME/.claude/voice-multiplexer/daemon.secret" 2>/dev/null)"
if [[ -n "$RELAY_SECRET" ]]; then
    curl -s -X PUT "http://localhost:3100/api/session-metadata/$SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "X-Daemon-Secret: $RELAY_SECRET" \
        -d "{\"hue_override\": $ITEM_HUE}" >/dev/null 2>&1 && \
        echo "  Hue: $ITEM_HUE" || true
fi

# Step 4: Optionally spawn delegator
if [[ "$NO_DELEGATOR" == "false" && "$DELEGATOR_ENABLED" != "False" ]]; then
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

emit_event "stream.activated" "Activated: $ITEM_TITLE" --item-id "$ITEM_ID" --session-id "$SESSION_ID"
