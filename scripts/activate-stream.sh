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
MAX_ACTIVE="$CONFIG_MAX_ACTIVE"
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
QUEUE_PY="python3 -m lib.queue"
ITEM_JSON="$(cd "$SCRIPT_DIR" && $QUEUE_PY get-item "$ITEM_ID")"

IFS=$'\x1f' read -r ITEM_STATUS ITEM_BRANCH ITEM_TITLE DELEGATOR_ENABLED ENV_REPO USE_WORKTREE COMMIT_STRATEGY <<< \
    "$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" status environment.branch title worker.delegator_enabled environment.repo environment.use_worktree worker.commit_strategy)"

# Apply defaults for delegator_enabled and expand ~ in repo path
[[ -z "$DELEGATOR_ENABLED" || "$DELEGATOR_ENABLED" == "None" ]] && DELEGATOR_ENABLED="$DELEGATOR_DEFAULT"
ENV_REPO="${ENV_REPO/#\~/$HOME}"

# Validate status
if [[ "$ITEM_STATUS" != "queued" && "$ITEM_STATUS" != "planning" ]]; then
    echo "ERROR: Item $ITEM_ID is '$ITEM_STATUS', expected 'queued' or 'planning'" >&2
    exit 1
fi

# Check concurrency (unified limit)
ACTIVE_COUNT="$(cd "$SCRIPT_DIR" && $QUEUE_PY count --status active)"
if [[ "$ACTIVE_COUNT" -ge "$MAX_ACTIVE" ]]; then
    echo "ERROR: Concurrency limit reached ($ACTIVE_COUNT/$MAX_ACTIVE active items)" >&2
    exit 1
fi

# Non-worktree items: use repo path directly (local directory or cross-repo)
if [[ "$USE_WORKTREE" == "False" && -n "$ENV_REPO" ]]; then
    echo "Activating: $ITEM_TITLE ($ITEM_ID)"
    echo "  Directory: $ENV_REPO (no worktree)"
    echo ""
    echo "Step 1: Preparing directory..."
    if [[ ! -d "$ENV_REPO" ]]; then
        mkdir -p "$ENV_REPO"
        echo "  Created: $ENV_REPO"
    else
        echo "  Already exists: $ENV_REPO"
    fi
    WORKTREE_PATH="$ENV_REPO"
elif [[ "$COMMIT_STRATEGY" == "graphite_stack" ]]; then
    # Graphite stack: create worktree from main — gt create will make branches
    if [[ -z "$ITEM_BRANCH" ]]; then
        echo "ERROR: Stack item $ITEM_ID has no branch prefix configured" >&2
        exit 1
    fi

    # Read stack_steps for the task message later
    STACK_STEPS_JSON="$(cd "$SCRIPT_DIR" && python3 -c "
import json, sys
item = json.loads(sys.stdin.read())
steps = item.get('worker', {}).get('stack_steps', [])
print(json.dumps(steps))
" <<< "$ITEM_JSON")"

    echo "Activating: $ITEM_TITLE ($ITEM_ID)"
    echo "  Branch prefix: $ITEM_BRANCH (graphite_stack)"
    echo "  Stack steps: $(echo "$STACK_STEPS_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")"

    # Step 1: Create worktree via Rostrum using the branch prefix
    echo ""
    echo "Step 1: Creating worktree via Rostrum..."
    cd "$REPO_PATH"

    # Reuse find_worktree_by_branch helper (defined in standard flow too)
    find_worktree_by_branch() {
        git worktree list --porcelain | awk -v branch="refs/heads/$1" '
            /^worktree / { wt=substr($0, 10) }
            /^branch / && $2 == branch { print wt; exit }
        '
    }

    EXISTING_WORKTREE="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" environment.worktree_path)"
    if [[ -n "$EXISTING_WORKTREE" && -d "$EXISTING_WORKTREE" ]]; then
        WORKTREE_PATH="$EXISTING_WORKTREE"
        echo "  Worktree already exists at $WORKTREE_PATH"
    else
        EXISTING_GIT_WORKTREE="$(find_worktree_by_branch "$ITEM_BRANCH")"
        if [[ -n "$EXISTING_GIT_WORKTREE" && -d "$EXISTING_GIT_WORKTREE" ]]; then
            WORKTREE_PATH="$EXISTING_GIT_WORKTREE"
            echo "  Worktree already exists at $WORKTREE_PATH"
        elif $ROSTRUM setup "$ITEM_BRANCH" --quick; then
            ACTUAL_WORKTREE="$(find_worktree_by_branch "$ITEM_BRANCH")"
            if [[ -n "$ACTUAL_WORKTREE" && -d "$ACTUAL_WORKTREE" ]]; then
                WORKTREE_PATH="$ACTUAL_WORKTREE"
            else
                echo "  ERROR: Rostrum created worktree but could not find it" >&2
                exit 1
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
else
    # Standard flow: validate branch and create worktree via Rostrum
    if [[ -z "$ITEM_BRANCH" ]]; then
        echo "ERROR: Item $ITEM_ID has no branch name configured" >&2
        exit 1
    fi

    echo "Activating: $ITEM_TITLE ($ITEM_ID)"
    echo "  Branch: $ITEM_BRANCH"

    # Step 1: Create worktree
    # Use existing worktree_path from queue item if available, otherwise compute from prefix
    EXISTING_WORKTREE="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" environment.worktree_path)"
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

# Guard: spawning a worker at the orchestrator's own directory would take over
# the orchestrator's vmux session. PROJECT_ROOT is computed dynamically from the
# script location — not hardcoded to any specific path.
REAL_WORKTREE="$(cd "$WORKTREE_PATH" 2>/dev/null && pwd -P)" || REAL_WORKTREE="$WORKTREE_PATH"
REAL_PROJECT="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P)" || REAL_PROJECT="$PROJECT_ROOT"
if [[ "$REAL_WORKTREE" == "$REAL_PROJECT" ]]; then
    echo "ERROR: WORKTREE_PATH resolved to the orchestrator root ($WORKTREE_PATH)" >&2
    echo "  This would take over the orchestrator's own session. Aborting." >&2
    exit 1
fi

# Step 2: Spawn worker session
echo ""
echo "Step 2: Spawning worker session..."
# Generate a short display name from the item ID and title
SESSION_NAME="$(python3 -c "
import re, sys, json
item = json.loads(sys.stdin.read())
title = item.get('title', '')
item_id = item.get('id', 'worker')
words = [w for w in title.split() if len(w) > 2][:3]
short = '-'.join(w.lower() for w in words) if words else 'worker'
short = re.sub(r'[^a-z0-9_-]', '', short)[:20]
print(f'{item_id}-{short}')
" <<< "$ITEM_JSON")"
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
        raw_id = line.split(']')[1].strip()
        # Extract hex ID from named format 'name (hex-id)' for consistency
        if '(' in raw_id and raw_id.endswith(')'):
            current_id = raw_id[raw_id.rindex('(') + 1:-1].strip()
        else:
            current_id = raw_id
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
    SESSION_ID="$(python3 -c "import hashlib; print(hashlib.sha256('$WORKTREE_PATH'.encode()).hexdigest()[:12])")"
    echo "  WARNING: Could not find session in vmux — using computed ID $SESSION_ID" >&2
fi

# Step 2b: Send task reference to the worker session
echo ""
echo "Step 2b: Sending task instructions to worker..."

# Build a concise task message that references the plan file
PLAN_FILE="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" plan.file)"
PLAN_FILE="${PLAN_FILE/#\~/$HOME}"

if [[ "$COMMIT_STRATEGY" == "graphite_stack" ]]; then
    # Build stack workflow instructions with step details
    STACK_INSTRUCTIONS="$(cd "$SCRIPT_DIR" && python3 -c "
import json, sys
item = json.loads(sys.stdin.read())
branch = (item.get('environment') or {}).get('branch', '')
steps = (item.get('worker') or {}).get('stack_steps', [])
lines = []
lines.append('')
lines.append('## Stack Workflow')
lines.append('')
lines.append('This is a Graphite stack. Work through the steps below in order.')
lines.append('')
for s in sorted(steps, key=lambda x: x.get('position', 0)):
    pos = s.get('position', 0)
    suffix = s.get('branch_suffix', '')
    desc = s.get('description', '')
    full_branch = f'{branch}/{pos}/{suffix}'
    lines.append(f'### Step {pos}: {desc}')
    lines.append(f'Branch: \`{full_branch}\`')
    lines.append(f'After implementing, run: \`gt create {full_branch} --message \"{desc}\"\`')
    lines.append('')
lines.append('### After all steps are complete:')
lines.append('1. Run \`gt submit --stack\` to push all branches and create PRs')
lines.append('2. Report completion')
print('\n'.join(lines))
" <<< "$ITEM_JSON")"

    TASK_MESSAGE="[Task Assignment] $ITEM_TITLE

Read your full implementation plan and task context at: $PLAN_FILE

Branch prefix: $ITEM_BRANCH
Status: Activating now — this is a Graphite stack. Follow the plan steps in order.
$STACK_INSTRUCTIONS"
else
    TASK_MESSAGE="[Task Assignment] $ITEM_TITLE

Read your full implementation plan and task context at: $PLAN_FILE

Branch: $ITEM_BRANCH
Status: Activating now — follow the plan steps in order."
fi

# Retry sending the task message until the session is in standby
MESSAGE_SENT=false
for attempt in $(seq 1 12); do
    if $VMUX send "$SESSION_ID" "$TASK_MESSAGE" 2>/dev/null; then
        echo "  Task instructions sent to worker"
        MESSAGE_SENT=true
        break
    fi
    echo "  Attempt $attempt/12: session not ready, waiting 5s..."
    sleep 5
done
if [[ "$MESSAGE_SENT" == "false" ]]; then
    echo "  WARNING: Could not send task instructions after 60s (worker may not have entered standby)" >&2
fi

# Step 3: Update queue item status
echo ""
echo "Step 3: Updating queue..."
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" status=active activated_at=NOW \
    environment.worktree_path="$WORKTREE_PATH" environment.session_id="$SESSION_ID"
echo "  Status: active"
echo "  Session ID: $SESSION_ID"

# Set deterministic hue for this work item (worker + delegator will share it)
ITEM_HUE="$(python3 -c "import hashlib; print(int(hashlib.md5('$ITEM_ID'.encode()).hexdigest()[:4], 16) % 360)")"
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
    echo "Step 4: Delegator skipped (no_delegator=$NO_DELEGATOR, enabled=$DELEGATOR_ENABLED)"
fi

echo ""
echo "Activation complete!"
echo "  Worktree: $WORKTREE_PATH"
echo "  Session: $SESSION_ID"
echo "  Status: active"

emit_event "stream.activated" "Activated: $ITEM_TITLE" --item-id "$ITEM_ID" --session-id "$SESSION_ID"
